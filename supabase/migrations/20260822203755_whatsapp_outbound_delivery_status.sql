alter table public.messages
  add column sent_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column failed_at timestamptz,
  add constraint messages_delivery_timestamps_by_direction
    check (
      direction = 'outbound'
      or (
        sent_at is null
        and delivered_at is null
        and read_at is null
        and failed_at is null
      )
    );

create function public.apply_whatsapp_outbound_delivery_status(
  p_organization_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_provider_status text,
  p_provider_timestamp timestamptz
)
returns table (
  outcome text,
  message_id uuid,
  delivery_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_message_id uuid;
  current_delivery_status text;
  current_sent_at timestamptz;
  current_delivered_at timestamptz;
  current_read_at timestamptz;
  current_failed_at timestamptz;
  next_sent_at timestamptz;
  next_delivered_at timestamptz;
  next_read_at timestamptz;
  next_failed_at timestamptz;
  next_delivery_status text;
  milestone_changed boolean;
begin
  if p_organization_id is null
    or p_connection_id is null
    or p_provider_message_id is null
    or char_length(p_provider_message_id) not between 1 and 255
    or p_provider_message_id <> btrim(p_provider_message_id)
    or p_provider_status is null
    or p_provider_status not in ('sent', 'delivered', 'read', 'failed')
    or p_provider_timestamp is null
  then
    raise exception 'invalid WhatsApp outbound delivery status'
      using errcode = '22023';
  end if;

  select
    message.id,
    message.delivery_status,
    message.sent_at,
    message.delivered_at,
    message.read_at,
    message.failed_at
  into
    target_message_id,
    current_delivery_status,
    current_sent_at,
    current_delivered_at,
    current_read_at,
    current_failed_at
  from public.messages as message
  join public.conversations as conversation
    on conversation.id = message.conversation_id
  join public.whatsapp_channel_connections as connection
    on connection.id = conversation.channel_connection_id
  where message.organization_id = p_organization_id
    and message.channel = 'whatsapp'
    and message.direction = 'outbound'
    and message.provider_message_id = p_provider_message_id
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and conversation.channel_connection_id = p_connection_id
    and connection.id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.status = 'active'
  for update of message;

  if not found then
    raise exception 'WhatsApp outbound delivery status target is unavailable'
      using errcode = '22023';
  end if;

  next_sent_at := current_sent_at;
  next_delivered_at := current_delivered_at;
  next_read_at := current_read_at;
  next_failed_at := current_failed_at;

  case p_provider_status
    when 'sent' then
      next_sent_at := case
        when current_sent_at is null then p_provider_timestamp
        else least(current_sent_at, p_provider_timestamp)
      end;
      milestone_changed := next_sent_at is distinct from current_sent_at;
    when 'delivered' then
      next_delivered_at := case
        when current_delivered_at is null then p_provider_timestamp
        else least(current_delivered_at, p_provider_timestamp)
      end;
      milestone_changed := next_delivered_at is distinct from current_delivered_at;
    when 'read' then
      next_read_at := case
        when current_read_at is null then p_provider_timestamp
        else least(current_read_at, p_provider_timestamp)
      end;
      milestone_changed := next_read_at is distinct from current_read_at;
    when 'failed' then
      next_failed_at := case
        when current_failed_at is null then p_provider_timestamp
        else least(current_failed_at, p_provider_timestamp)
      end;
      milestone_changed := next_failed_at is distinct from current_failed_at;
  end case;

  next_delivery_status := case
    when next_read_at is not null then 'read'
    when next_delivered_at is not null then 'delivered'
    when next_failed_at is not null then 'failed'
    when next_sent_at is not null then 'sent'
    else 'accepted'
  end;

  if not milestone_changed
    and next_delivery_status = current_delivery_status
  then
    return query
      select 'duplicate'::text, target_message_id, current_delivery_status;
    return;
  end if;

  update public.messages as message
  set
    sent_at = next_sent_at,
    delivered_at = next_delivered_at,
    read_at = next_read_at,
    failed_at = next_failed_at,
    delivery_status = next_delivery_status
  where message.id = target_message_id;

  return query
    select 'updated'::text, target_message_id, next_delivery_status;
end;
$$;

revoke all
on function public.apply_whatsapp_outbound_delivery_status(
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant update (
  sent_at,
  delivered_at,
  read_at,
  failed_at,
  delivery_status
)
on public.messages
to service_role;

grant execute
on function public.apply_whatsapp_outbound_delivery_status(
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
to service_role;

comment on function public.apply_whatsapp_outbound_delivery_status(
  uuid,
  uuid,
  text,
  text,
  timestamptz
)
is 'Applies one tenant-safe idempotent WhatsApp outbound delivery milestone without state regression.';
