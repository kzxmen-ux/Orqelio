alter table public.messages
  drop constraint messages_direction,
  drop constraint messages_sender_external_id;

alter table public.messages
  alter column sender_external_id drop not null,
  alter column provider_timestamp drop not null,
  add column delivery_status text not null default 'received';

alter table public.messages
  add constraint messages_direction
    check (direction in ('inbound', 'outbound')),
  add constraint messages_sender_external_id
    check (
      (
        direction = 'inbound'
        and sender_external_id is not null
        and sender_external_id ~ '^[0-9]{1,32}$'
      )
      or (
        direction = 'outbound'
        and (
          sender_external_id is null
          or sender_external_id ~ '^[0-9]{1,32}$'
        )
      )
    ),
  add constraint messages_provider_timestamp_by_direction
    check (
      (direction = 'inbound' and provider_timestamp is not null)
      or direction = 'outbound'
    ),
  add constraint messages_delivery_status_by_direction
    check (
      (direction = 'inbound' and delivery_status = 'received')
      or (
        direction = 'outbound'
        and delivery_status in (
          'accepted',
          'sent',
          'delivered',
          'read',
          'failed'
        )
      )
    );

create function public.store_whatsapp_outbound_message(
  p_organization_id uuid,
  p_connection_id uuid,
  p_conversation_id uuid,
  p_provider_message_id text,
  p_text_content text
)
returns table (
  outcome text,
  message_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  outbound_message_at timestamptz := clock_timestamp();
  inserted_message_id uuid;
  existing_message_id uuid;
  existing_organization_id uuid;
  existing_conversation_id uuid;
  existing_connection_id uuid;
  existing_direction text;
  existing_message_type text;
  existing_text_content text;
begin
  if p_organization_id is null
    or p_connection_id is null
    or p_conversation_id is null
    or p_provider_message_id is null
    or char_length(p_provider_message_id) not between 1 and 255
    or p_provider_message_id <> btrim(p_provider_message_id)
    or p_text_content is null
    or char_length(btrim(p_text_content)) = 0
  then
    raise exception 'invalid WhatsApp outbound message'
      using errcode = '22023';
  end if;

  perform 1
  from public.conversations as conversation
  join public.whatsapp_channel_connections as connection
    on connection.id = conversation.channel_connection_id
  where conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and conversation.channel_connection_id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.status = 'active';

  if not found then
    raise exception 'WhatsApp outbound conversation is unavailable'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_outbound_message'),
    pg_catalog.hashtext(p_provider_message_id)
  );

  select
    message.id,
    message.organization_id,
    message.conversation_id,
    conversation.channel_connection_id,
    message.direction,
    message.message_type,
    message.text_content
  into
    existing_message_id,
    existing_organization_id,
    existing_conversation_id,
    existing_connection_id,
    existing_direction,
    existing_message_type,
    existing_text_content
  from public.messages as message
  join public.conversations as conversation
    on conversation.id = message.conversation_id
  where message.channel = 'whatsapp'
    and message.provider_message_id = p_provider_message_id;

  if existing_message_id is not null then
    if existing_organization_id <> p_organization_id
      or existing_conversation_id <> p_conversation_id
      or existing_connection_id <> p_connection_id
      or existing_direction <> 'outbound'
      or existing_message_type <> 'text'
      or existing_text_content is distinct from p_text_content
    then
      raise exception 'WhatsApp provider message identity conflict'
        using errcode = '22023';
    end if;

    return query
      select 'duplicate'::text, existing_message_id;
    return;
  end if;

  insert into public.messages (
    organization_id,
    conversation_id,
    channel,
    direction,
    provider_message_id,
    sender_external_id,
    message_type,
    text_content,
    provider_timestamp,
    delivery_status
  )
  values (
    p_organization_id,
    p_conversation_id,
    'whatsapp',
    'outbound',
    p_provider_message_id,
    null,
    'text',
    p_text_content,
    null,
    'accepted'
  )
  returning id into inserted_message_id;

  update public.conversations as conversation
  set last_message_at = case
    when conversation.last_message_at is null
      or outbound_message_at > conversation.last_message_at
    then outbound_message_at
    else conversation.last_message_at
  end
  where conversation.id = p_conversation_id;

  return query
    select 'accepted'::text, inserted_message_id;
end;
$$;

revoke all
on function public.store_whatsapp_outbound_message(
  uuid,
  uuid,
  uuid,
  text,
  text
)
from public, anon, authenticated;

grant execute
on function public.store_whatsapp_outbound_message(
  uuid,
  uuid,
  uuid,
  text,
  text
)
to service_role;

comment on column public.messages.delivery_status is
  'Provider delivery lifecycle. Inbound messages remain received; outbound messages begin accepted.';

comment on table public.messages is
  'Server-only inbound and outbound WhatsApp messages with provider-level idempotency.';

comment on function public.store_whatsapp_outbound_message(
  uuid,
  uuid,
  uuid,
  text,
  text
)
is 'Atomically verifies tenant conversation identity and stores one idempotent outbound WhatsApp text message.';
