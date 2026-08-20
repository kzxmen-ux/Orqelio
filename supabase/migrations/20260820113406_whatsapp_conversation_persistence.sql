create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  channel text not null,
  channel_connection_id uuid not null
    references public.whatsapp_channel_connections (id) on delete cascade,
  external_participant_id text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_channel
    check (channel = 'whatsapp'),
  constraint conversations_external_participant_id
    check (external_participant_id ~ '^[0-9]{1,32}$'),
  constraint conversations_display_name_length
    check (display_name is null or char_length(display_name) <= 256),
  constraint conversations_identity_unique
    unique (
      organization_id,
      channel_connection_id,
      external_participant_id
    )
);

create index conversations_channel_connection_idx
  on public.conversations (channel_connection_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  channel text not null,
  direction text not null,
  provider_message_id text not null,
  sender_external_id text not null,
  message_type text not null,
  text_content text,
  provider_timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  constraint messages_channel
    check (channel = 'whatsapp'),
  constraint messages_direction
    check (direction = 'inbound'),
  constraint messages_provider_message_id
    check (
      char_length(provider_message_id) between 1 and 255
      and provider_message_id = btrim(provider_message_id)
    ),
  constraint messages_sender_external_id
    check (sender_external_id ~ '^[0-9]{1,32}$'),
  constraint messages_message_type
    check (
      char_length(message_type) between 1 and 64
      and message_type = btrim(message_type)
    ),
  constraint messages_text_content
    check (
      (message_type = 'text' and text_content is not null)
      or (message_type <> 'text' and text_content is null)
    ),
  constraint messages_provider_message_unique
    unique (channel, provider_message_id)
);

create index messages_organization_idx
  on public.messages (organization_id);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

revoke all on public.conversations from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;

grant select, insert, update
on public.conversations
to service_role;

grant select, insert
on public.messages
to service_role;

create function private.set_conversation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all
on function private.set_conversation_updated_at()
from public, anon, authenticated, service_role;

create trigger conversations_set_updated_at
before update on public.conversations
for each row
execute function private.set_conversation_updated_at();

create function public.store_whatsapp_inbound_message(
  p_organization_id uuid,
  p_connection_id uuid,
  p_waba_id text,
  p_phone_number_id text,
  p_external_participant_id text,
  p_display_name text,
  p_provider_message_id text,
  p_sender_external_id text,
  p_message_type text,
  p_text_content text,
  p_provider_timestamp timestamptz
)
returns table (
  outcome text,
  conversation_id uuid,
  message_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  inserted_message_id uuid;
  existing_message_id uuid;
  existing_conversation_id uuid;
  existing_organization_id uuid;
  existing_connection_id uuid;
  existing_participant_id text;
begin
  if p_organization_id is null
    or p_connection_id is null
    or p_waba_id is null
    or p_waba_id !~ '^[0-9]{1,32}$'
    or p_phone_number_id is null
    or p_phone_number_id !~ '^[0-9]{1,32}$'
    or p_external_participant_id is null
    or p_external_participant_id !~ '^[0-9]{1,32}$'
    or p_provider_message_id is null
    or char_length(p_provider_message_id) not between 1 and 255
    or p_provider_message_id <> btrim(p_provider_message_id)
    or p_sender_external_id is null
    or p_sender_external_id !~ '^[0-9]{1,32}$'
    or p_message_type is null
    or char_length(p_message_type) not between 1 and 64
    or p_message_type <> btrim(p_message_type)
    or p_provider_timestamp is null
    or (p_display_name is not null and char_length(p_display_name) > 256)
    or (p_message_type = 'text' and p_text_content is null)
    or (p_message_type <> 'text' and p_text_content is not null)
  then
    raise exception 'invalid WhatsApp inbound message'
      using errcode = '22023';
  end if;

  perform 1
  from public.whatsapp_channel_connections as connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.waba_id = p_waba_id
    and connection.phone_number_id = p_phone_number_id
    and connection.status = 'active';

  if not found then
    raise exception 'WhatsApp connection is unavailable'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_inbound_message'),
    pg_catalog.hashtext(p_provider_message_id)
  );

  select
    message.id,
    message.conversation_id,
    message.organization_id,
    conversation.channel_connection_id,
    conversation.external_participant_id
  into
    existing_message_id,
    existing_conversation_id,
    existing_organization_id,
    existing_connection_id,
    existing_participant_id
  from public.messages as message
  join public.conversations as conversation
    on conversation.id = message.conversation_id
  where message.channel = 'whatsapp'
    and message.provider_message_id = p_provider_message_id;

  if existing_message_id is not null then
    if existing_organization_id <> p_organization_id
      or existing_connection_id <> p_connection_id
      or existing_participant_id <> p_external_participant_id
    then
      raise exception 'WhatsApp provider message identity conflict'
        using errcode = '22023';
    end if;

    return query
      select
        'duplicate'::text,
        existing_conversation_id,
        existing_message_id;
    return;
  end if;

  insert into public.conversations (
    organization_id,
    channel,
    channel_connection_id,
    external_participant_id,
    display_name,
    last_message_at
  )
  values (
    p_organization_id,
    'whatsapp',
    p_connection_id,
    p_external_participant_id,
    p_display_name,
    p_provider_timestamp
  )
  on conflict (
    organization_id,
    channel_connection_id,
    external_participant_id
  )
  do update set
    display_name = coalesce(
      excluded.display_name,
      conversations.display_name
    ),
    last_message_at = case
      when conversations.last_message_at is null
        or excluded.last_message_at > conversations.last_message_at
      then excluded.last_message_at
      else conversations.last_message_at
    end
  returning id into target_conversation_id;

  insert into public.messages (
    organization_id,
    conversation_id,
    channel,
    direction,
    provider_message_id,
    sender_external_id,
    message_type,
    text_content,
    provider_timestamp
  )
  values (
    p_organization_id,
    target_conversation_id,
    'whatsapp',
    'inbound',
    p_provider_message_id,
    p_sender_external_id,
    p_message_type,
    p_text_content,
    p_provider_timestamp
  )
  returning id into inserted_message_id;

  return query
    select 'accepted'::text, target_conversation_id, inserted_message_id;
end;
$$;

revoke all
on function public.store_whatsapp_inbound_message(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
)
from public, anon, authenticated;

grant execute
on function public.store_whatsapp_inbound_message(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
)
to service_role;

comment on table public.conversations is
  'Server-only WhatsApp conversation identity and display metadata owned by Orqelio.';

comment on table public.messages is
  'Server-only inbound WhatsApp messages with provider-level idempotency.';

comment on function public.store_whatsapp_inbound_message(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
)
is 'Atomically verifies active tenant routing, upserts one conversation, and stores one idempotent inbound WhatsApp message.';
