create table public.whatsapp_outbound_dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  conversation_id uuid not null references public.conversations(id),
  connection_id uuid not null references public.whatsapp_channel_connections(id),
  text_content text not null,
  state text not null default 'prepared',
  provider_message_id text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  provider_accepted_at timestamptz,
  persisted_at timestamptz,
  constraint whatsapp_outbound_dispatches_text_content
    check (char_length(btrim(text_content)) > 0),
  constraint whatsapp_outbound_dispatches_state
    check (
      state in (
        'prepared',
        'dispatching',
        'provider_accepted',
        'persisted',
        'indeterminate'
      )
    ),
  constraint whatsapp_outbound_dispatches_provider_message_id
    check (
      provider_message_id is null
      or (
        char_length(provider_message_id) between 1 and 255
        and provider_message_id = btrim(provider_message_id)
      )
    ),
  constraint whatsapp_outbound_dispatches_state_fields
    check (
      (
        state in ('prepared', 'dispatching', 'indeterminate')
        and provider_message_id is null
        and provider_accepted_at is null
        and persisted_at is null
      )
      or (
        state = 'provider_accepted'
        and provider_message_id is not null
        and provider_accepted_at is not null
        and persisted_at is null
      )
      or (
        state = 'persisted'
        and provider_message_id is not null
        and provider_accepted_at is not null
        and persisted_at is not null
      )
    )
);

create unique index whatsapp_outbound_dispatches_provider_message_id_key
  on public.whatsapp_outbound_dispatches (provider_message_id)
  where provider_message_id is not null;

create index whatsapp_outbound_dispatches_organization_id_idx
  on public.whatsapp_outbound_dispatches (organization_id);

create index whatsapp_outbound_dispatches_conversation_id_idx
  on public.whatsapp_outbound_dispatches (conversation_id);

create index whatsapp_outbound_dispatches_connection_id_idx
  on public.whatsapp_outbound_dispatches (connection_id);

create index whatsapp_outbound_dispatches_recovery_idx
  on public.whatsapp_outbound_dispatches (state, updated_at)
  where state in ('dispatching', 'provider_accepted', 'indeterminate');

alter table public.whatsapp_outbound_dispatches enable row level security;
alter table public.whatsapp_outbound_dispatches force row level security;

revoke all on table public.whatsapp_outbound_dispatches
from public, anon, authenticated;

grant select, insert, update on table public.whatsapp_outbound_dispatches
to service_role;

create function public.prepare_whatsapp_outbound_dispatch(
  p_organization_id uuid,
  p_connection_id uuid,
  p_conversation_id uuid,
  p_text_content text
)
returns table (
  dispatch_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prepared_dispatch_id uuid;
begin
  if p_organization_id is null
    or p_connection_id is null
    or p_conversation_id is null
    or p_text_content is null
    or char_length(btrim(p_text_content)) = 0
  then
    raise exception 'invalid WhatsApp outbound dispatch'
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

  insert into public.whatsapp_outbound_dispatches (
    organization_id,
    conversation_id,
    connection_id,
    text_content
  )
  values (
    p_organization_id,
    p_conversation_id,
    p_connection_id,
    p_text_content
  )
  returning id into prepared_dispatch_id;

  return query select prepared_dispatch_id;
end;
$$;

create function public.get_whatsapp_outbound_dispatch_recovery_state(
  p_organization_id uuid,
  p_dispatch_id uuid
)
returns table (
  dispatch_id uuid,
  state text,
  provider_message_id text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_organization_id is null or p_dispatch_id is null then
    raise exception 'invalid WhatsApp outbound dispatch recovery lookup'
      using errcode = '22023';
  end if;

  return query
    select dispatch.id, dispatch.state, dispatch.provider_message_id
    from public.whatsapp_outbound_dispatches as dispatch
    where dispatch.id = p_dispatch_id
      and dispatch.organization_id = p_organization_id;

  if not found then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;
end;
$$;

create function public.mark_whatsapp_outbound_dispatching(
  p_organization_id uuid,
  p_dispatch_id uuid
)
returns table (
  dispatch_id uuid,
  state text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_state text;
begin
  if p_organization_id is null or p_dispatch_id is null then
    raise exception 'invalid WhatsApp outbound dispatch transition'
      using errcode = '22023';
  end if;

  select dispatch.state
  into current_state
  from public.whatsapp_outbound_dispatches as dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.organization_id = p_organization_id
  for update;

  if not found or current_state not in ('prepared', 'dispatching') then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;

  if current_state = 'prepared' then
    update public.whatsapp_outbound_dispatches as dispatch
    set state = 'dispatching', updated_at = clock_timestamp()
    where dispatch.id = p_dispatch_id;
  end if;

  return query select p_dispatch_id, 'dispatching'::text;
end;
$$;

create function public.record_whatsapp_outbound_provider_acceptance(
  p_organization_id uuid,
  p_dispatch_id uuid,
  p_provider_message_id text
)
returns table (
  dispatch_id uuid,
  state text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_state text;
  current_provider_message_id text;
begin
  if p_organization_id is null
    or p_dispatch_id is null
    or p_provider_message_id is null
    or char_length(p_provider_message_id) not between 1 and 255
    or p_provider_message_id <> btrim(p_provider_message_id)
  then
    raise exception 'invalid WhatsApp provider acceptance'
      using errcode = '22023';
  end if;

  select dispatch.state, dispatch.provider_message_id
  into current_state, current_provider_message_id
  from public.whatsapp_outbound_dispatches as dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;

  if current_state in ('provider_accepted', 'persisted') then
    if current_provider_message_id is distinct from p_provider_message_id then
      raise exception 'WhatsApp provider message identity conflict'
        using errcode = '22023';
    end if;

    return query select p_dispatch_id, current_state;
    return;
  end if;

  if current_state <> 'dispatching' then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;

  begin
    update public.whatsapp_outbound_dispatches as dispatch
    set
      state = 'provider_accepted',
      provider_message_id = p_provider_message_id,
      provider_accepted_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where dispatch.id = p_dispatch_id;
  exception
    when unique_violation then
      raise exception 'WhatsApp provider message identity conflict'
        using errcode = '22023';
  end;

  return query select p_dispatch_id, 'provider_accepted'::text;
end;
$$;

create function public.mark_whatsapp_outbound_dispatch_indeterminate(
  p_organization_id uuid,
  p_dispatch_id uuid
)
returns table (
  dispatch_id uuid,
  state text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_state text;
begin
  if p_organization_id is null or p_dispatch_id is null then
    raise exception 'invalid WhatsApp outbound dispatch transition'
      using errcode = '22023';
  end if;

  select dispatch.state
  into current_state
  from public.whatsapp_outbound_dispatches as dispatch
  where dispatch.id = p_dispatch_id
    and dispatch.organization_id = p_organization_id
  for update;

  if not found or current_state not in ('dispatching', 'indeterminate') then
    raise exception 'WhatsApp outbound dispatch is unavailable'
      using errcode = '22023';
  end if;

  if current_state = 'dispatching' then
    update public.whatsapp_outbound_dispatches as dispatch
    set state = 'indeterminate', updated_at = clock_timestamp()
    where dispatch.id = p_dispatch_id;
  end if;

  return query select p_dispatch_id, 'indeterminate'::text;
end;
$$;

create function public.finalize_whatsapp_outbound_dispatch(
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
    and connection.organization_id = p_organization_id
    and connection.status = 'active';

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

create or replace function public.apply_whatsapp_outbound_delivery_status(
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
  recovery_dispatch_id uuid;
  recovery_dispatch_state text;
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
    select dispatch.id, dispatch.state
    into recovery_dispatch_id, recovery_dispatch_state
    from public.whatsapp_outbound_dispatches as dispatch
    where dispatch.organization_id = p_organization_id
      and dispatch.connection_id = p_connection_id
      and dispatch.provider_message_id = p_provider_message_id
      and dispatch.state in ('provider_accepted', 'persisted')
    for update;

    if not found then
      raise exception 'WhatsApp outbound delivery status target is unavailable'
        using errcode = '22023';
    end if;

    if recovery_dispatch_state = 'provider_accepted' then
      perform *
      from public.finalize_whatsapp_outbound_dispatch(
        p_organization_id,
        recovery_dispatch_id
      );
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

revoke all on function public.prepare_whatsapp_outbound_dispatch(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.mark_whatsapp_outbound_dispatching(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.get_whatsapp_outbound_dispatch_recovery_state(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.record_whatsapp_outbound_provider_acceptance(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.mark_whatsapp_outbound_dispatch_indeterminate(
  uuid, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_whatsapp_outbound_dispatch(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.prepare_whatsapp_outbound_dispatch(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.mark_whatsapp_outbound_dispatching(
  uuid, uuid
) to service_role;
grant execute on function public.get_whatsapp_outbound_dispatch_recovery_state(
  uuid, uuid
) to service_role;
grant execute on function public.record_whatsapp_outbound_provider_acceptance(
  uuid, uuid, text
) to service_role;
grant execute on function public.mark_whatsapp_outbound_dispatch_indeterminate(
  uuid, uuid
) to service_role;
grant execute on function public.finalize_whatsapp_outbound_dispatch(
  uuid, uuid
) to service_role;

comment on table public.whatsapp_outbound_dispatches is
  'Server-only durable journal for one-attempt WhatsApp outbound dispatch and database-only recovery.';
