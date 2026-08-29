create or replace function public.prepare_ai_reply_whatsapp_dispatch(
  p_organization_id uuid,
  p_ai_message_run_id uuid
)
returns table (
  dispatch_id uuid,
  state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_conversation_id uuid;
  source_connection_id uuid;
  source_reply_text text;
  existing_dispatch_id uuid;
  existing_dispatch_organization_id uuid;
  existing_dispatch_conversation_id uuid;
  existing_dispatch_connection_id uuid;
  existing_dispatch_state text;
  existing_connection_organization_id uuid;
  existing_connection_status text;
begin
  if p_organization_id is null or p_ai_message_run_id is null then
    raise exception 'invalid AI reply WhatsApp dispatch'
      using errcode = '22023';
  end if;

  select
    run.conversation_id,
    conversation.channel_connection_id,
    run.decision ->> 'text'
  into
    source_conversation_id,
    source_connection_id,
    source_reply_text
  from public.ai_message_runs as run
  join public.conversations as conversation
    on conversation.id = run.conversation_id
  where run.id = p_ai_message_run_id
    and run.organization_id = p_organization_id
    and run.status = 'decided'
    and jsonb_typeof(run.decision) = 'object'
    and run.decision ->> 'action' = 'reply'
    and run.decision - array['action', 'text'] = '{}'::jsonb
    and jsonb_typeof(run.decision -> 'text') = 'string'
    and char_length(run.decision ->> 'text') between 1 and 2000
    and run.decision ->> 'text' = btrim(run.decision ->> 'text')
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
  for update of run
  for share of conversation;

  if not found then
    raise exception 'AI reply WhatsApp dispatch source is unavailable'
      using errcode = '22023';
  end if;

  select
    dispatch.id,
    dispatch.organization_id,
    dispatch.conversation_id,
    dispatch.connection_id,
    dispatch.state,
    connection.organization_id,
    connection.status
  into
    existing_dispatch_id,
    existing_dispatch_organization_id,
    existing_dispatch_conversation_id,
    existing_dispatch_connection_id,
    existing_dispatch_state,
    existing_connection_organization_id,
    existing_connection_status
  from public.whatsapp_outbound_dispatches as dispatch
  left join public.whatsapp_channel_connections as connection
    on connection.id = dispatch.connection_id
  where dispatch.source_ai_message_run_id = p_ai_message_run_id;

  if not found then
    perform 1
    from public.whatsapp_channel_connections as connection
    where source_connection_id is not null
      and connection.id = source_connection_id
      and connection.organization_id = p_organization_id
      and connection.status = 'active'
    for share of connection;

    if not found then
      raise exception 'AI reply WhatsApp dispatch source is unavailable'
        using errcode = '22023';
    end if;

    insert into public.whatsapp_outbound_dispatches (
      organization_id,
      conversation_id,
      connection_id,
      text_content,
      state,
      source_ai_message_run_id
    )
    values (
      p_organization_id,
      source_conversation_id,
      source_connection_id,
      source_reply_text,
      'prepared',
      p_ai_message_run_id
    )
    on conflict (source_ai_message_run_id) do nothing;

    select
      dispatch.id,
      dispatch.organization_id,
      dispatch.conversation_id,
      dispatch.connection_id,
      dispatch.state,
      connection.organization_id,
      connection.status
    into
      existing_dispatch_id,
      existing_dispatch_organization_id,
      existing_dispatch_conversation_id,
      existing_dispatch_connection_id,
      existing_dispatch_state,
      existing_connection_organization_id,
      existing_connection_status
    from public.whatsapp_outbound_dispatches as dispatch
    left join public.whatsapp_channel_connections as connection
      on connection.id = dispatch.connection_id
    where dispatch.source_ai_message_run_id = p_ai_message_run_id;

    if not found then
      raise exception 'AI reply WhatsApp dispatch preparation failed'
        using errcode = 'P0001';
    end if;
  end if;

  if existing_dispatch_organization_id <> p_organization_id
    or existing_dispatch_conversation_id <> source_conversation_id
    or existing_dispatch_connection_id is distinct from source_connection_id
    or existing_connection_organization_id is distinct from p_organization_id
    or existing_dispatch_state not in (
      'prepared',
      'dispatching',
      'provider_accepted',
      'persisted',
      'indeterminate'
    )
    or (
      existing_dispatch_state = 'prepared'
      and existing_connection_status is distinct from 'active'
    )
  then
    raise exception 'AI reply WhatsApp dispatch is unavailable'
      using errcode = '22023';
  end if;

  return query
    select existing_dispatch_id, existing_dispatch_state;
end;
$$;

create or replace function public.finalize_whatsapp_outbound_dispatch(
  p_organization_id uuid,
  p_dispatch_id uuid
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
  target_conversation_id uuid;
  target_connection_id uuid;
  target_text_content text;
  target_provider_message_id text;
  target_provider_accepted_at timestamptz;
  target_state text;
  existing_message_id uuid;
  existing_organization_id uuid;
  existing_conversation_id uuid;
  existing_connection_id uuid;
  existing_direction text;
  existing_message_type text;
  existing_text_content text;
  inserted_message_id uuid;
  persistence_outcome text;
begin
  if p_organization_id is null or p_dispatch_id is null then
    raise exception 'invalid WhatsApp outbound dispatch finalization'
      using errcode = '22023';
  end if;

  select
    dispatch.conversation_id,
    dispatch.connection_id,
    dispatch.text_content,
    dispatch.provider_message_id,
    dispatch.provider_accepted_at,
    dispatch.state
  into
    target_conversation_id,
    target_connection_id,
    target_text_content,
    target_provider_message_id,
    target_provider_accepted_at,
    target_state
  from public.whatsapp_outbound_dispatches as dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.organization_id = p_organization_id
  for update;

  if not found
    or target_state not in ('provider_accepted', 'persisted')
    or target_provider_message_id is null
  then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;

  perform 1
  from public.conversations as conversation
  join public.whatsapp_channel_connections as connection
    on connection.id = conversation.channel_connection_id
  where conversation.id = target_conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and conversation.channel_connection_id = target_connection_id
    and connection.organization_id = p_organization_id;

  if not found then
    raise exception 'WhatsApp outbound conversation is unavailable'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('whatsapp_outbound_message'),
    pg_catalog.hashtext(target_provider_message_id)
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
    and message.provider_message_id = target_provider_message_id
  for update of message;

  if existing_message_id is not null then
    if existing_organization_id <> p_organization_id
      or existing_conversation_id <> target_conversation_id
      or existing_connection_id <> target_connection_id
      or existing_direction <> 'outbound'
      or existing_message_type <> 'text'
      or existing_text_content is distinct from target_text_content
    then
      raise exception 'WhatsApp provider message identity conflict'
        using errcode = '22023';
    end if;

    inserted_message_id := existing_message_id;
    persistence_outcome := 'duplicate';
  else
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
      target_conversation_id,
      'whatsapp',
      'outbound',
      target_provider_message_id,
      null,
      'text',
      target_text_content,
      null,
      'accepted'
    )
    returning id into inserted_message_id;

    persistence_outcome := 'accepted';
  end if;

  update public.conversations as conversation
  set last_message_at = case
    when conversation.last_message_at is null
      or target_provider_accepted_at > conversation.last_message_at
    then target_provider_accepted_at
    else conversation.last_message_at
  end
  where conversation.id = target_conversation_id;

  update public.whatsapp_outbound_dispatches as dispatch
  set
    state = 'persisted',
    persisted_at = coalesce(dispatch.persisted_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where dispatch.id = p_dispatch_id;

  return query select persistence_outcome, inserted_message_id;
end;
$$;

revoke all
on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid)
to service_role;

revoke all
on function public.finalize_whatsapp_outbound_dispatch(uuid, uuid)
from public, anon, authenticated;

grant execute
on function public.finalize_whatsapp_outbound_dispatch(uuid, uuid)
to service_role;

comment on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid) is
  'Validates a terminal AI reply, safely reuses every existing bound dispatch state, and requires an active connection only to create or execute prepared work.';

comment on function public.finalize_whatsapp_outbound_dispatch(uuid, uuid) is
  'Idempotently persists provider-accepted WhatsApp evidence without requiring the bound connection to remain active.';
