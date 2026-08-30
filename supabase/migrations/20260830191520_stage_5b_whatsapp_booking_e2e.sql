-- Reuse source_ai_message_run_id's existing UNIQUE constraint and the existing
-- outbound state machine. No second sender or local booking authority.
create or replace function public.prepare_booking_mutation_execution(
  p_organization_id uuid,
  p_ai_message_run_id uuid,
  p_trusted_request jsonb
)
returns table (
  execution_id uuid,
  execution_state text,
  terminal_result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bound_conversation_id uuid;
  prepared_execution_id uuid;
  prepared_state text;
  prepared_terminal_result jsonb;
begin
  if p_organization_id is null
    or p_ai_message_run_id is null
    or p_trusted_request is null
  then
    raise exception 'invalid booking mutation preparation'
      using errcode = '22023';
  end if;

  if not coalesce(
    jsonb_typeof(p_trusted_request) = 'object'
    and p_trusted_request ?& array[
      'intent',
      'serviceId',
      'staffId',
      'startAt',
      'customer'
    ]
    and p_trusted_request - array[
      'intent',
      'serviceId',
      'staffId',
      'startAt',
      'customer'
    ] = '{}'::jsonb
    and p_trusted_request ->> 'intent' = 'create_appointment'
    and jsonb_typeof(p_trusted_request -> 'serviceId') = 'string'
    and char_length(p_trusted_request ->> 'serviceId') between 1 and 255
    and p_trusted_request ->> 'serviceId'
      = btrim(p_trusted_request ->> 'serviceId')
    and jsonb_typeof(p_trusted_request -> 'staffId') = 'string'
    and char_length(p_trusted_request ->> 'staffId') between 1 and 255
    and p_trusted_request ->> 'staffId'
      = btrim(p_trusted_request ->> 'staffId')
    and jsonb_typeof(p_trusted_request -> 'startAt') = 'string'
    and char_length(p_trusted_request ->> 'startAt') between 1 and 64
    and p_trusted_request ->> 'startAt'
      = btrim(p_trusted_request ->> 'startAt')
    and jsonb_typeof(p_trusted_request -> 'customer') = 'object'
    and (p_trusted_request -> 'customer') ?& array['name', 'phone']
    and (p_trusted_request -> 'customer') - array['name', 'phone'] = '{}'::jsonb
    and jsonb_typeof(p_trusted_request -> 'customer' -> 'name') = 'string'
    and char_length(p_trusted_request -> 'customer' ->> 'name') between 1 and 500
    and p_trusted_request -> 'customer' ->> 'name'
      = btrim(p_trusted_request -> 'customer' ->> 'name')
    and jsonb_typeof(p_trusted_request -> 'customer' -> 'phone') = 'string'
    and p_trusted_request -> 'customer' ->> 'phone' ~ '^[0-9]{1,32}$',
    false
  ) then
    raise exception 'invalid trusted booking mutation request'
      using errcode = '22023';
  end if;

  select run.conversation_id
  into bound_conversation_id
  from public.ai_message_runs as run
  join public.conversations as conversation
    on conversation.id = run.conversation_id
  join public.whatsapp_channel_connections as connection
    on connection.id = conversation.channel_connection_id
  where run.id = p_ai_message_run_id
    and run.organization_id = p_organization_id
    and run.status = 'decided'
    and jsonb_typeof(run.decision) = 'object'
    and run.decision ->> 'action' = 'booking_action_required'
    and run.decision ->> 'bookingIntent' = 'create_appointment'
    and run.decision - array[
      'action',
      'bookingIntent',
      'bookingRequest'
    ] = '{}'::jsonb
    and jsonb_typeof(run.decision -> 'bookingRequest') = 'object'
    and (run.decision -> 'bookingRequest') ?& array[
      'serviceQuery',
      'staffQuery',
      'dateText',
      'timeText',
      'customerName',
      'customerPhone',
      'appointmentReference'
    ]
    and (run.decision -> 'bookingRequest') - array[
      'serviceQuery',
      'staffQuery',
      'dateText',
      'timeText',
      'customerName',
      'customerPhone',
      'appointmentReference'
    ] = '{}'::jsonb
    and not exists (
      select 1
      from jsonb_each(run.decision -> 'bookingRequest') as field(key, value)
      where value <> 'null'::jsonb
        and (
          jsonb_typeof(value) <> 'string'
          or char_length(value #>> '{}') not between 1 and 500
          or value #>> '{}' <> btrim(value #>> '{}')
        )
    )
    and conversation.id = run.conversation_id
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and conversation.external_participant_id ~ '^[0-9]{1,32}$'
    and connection.organization_id = p_organization_id
    and connection.status = 'active'
    and p_trusted_request -> 'customer' ->> 'phone'
      = conversation.external_participant_id
  for update of run
  for share of conversation, connection;

  if not found then
    raise exception 'booking mutation source is unavailable'
      using errcode = '22023';
  end if;

  -- Response preparation holds the same run lock. Once a run has an outbound
  -- answer, a concurrent stale composer must not start a new mutation.
  if exists (
    select 1 from public.whatsapp_outbound_dispatches as dispatch
    where dispatch.source_ai_message_run_id = p_ai_message_run_id
  ) and not exists (
    select 1 from public.booking_mutation_executions as execution
    where execution.source_ai_message_run_id = p_ai_message_run_id
  ) then
    raise exception 'booking run already answered' using errcode = '22023';
  end if;

  insert into public.booking_mutation_executions (
    organization_id,
    conversation_id,
    source_ai_message_run_id,
    trusted_request,
    state
  )
  values (
    p_organization_id,
    bound_conversation_id,
    p_ai_message_run_id,
    p_trusted_request,
    'prepared'
  )
  on conflict (source_ai_message_run_id) do nothing;

  select execution.id, execution.state, execution.terminal_result
  into prepared_execution_id, prepared_state, prepared_terminal_result
  from public.booking_mutation_executions as execution
  where execution.source_ai_message_run_id = p_ai_message_run_id
    and execution.organization_id = p_organization_id
    and execution.conversation_id = bound_conversation_id;

  if not found then
    raise exception 'booking mutation preparation failed'
      using errcode = 'P0001';
  end if;

  return query
    select prepared_execution_id, prepared_state, prepared_terminal_result;
end;
$$;

create function public.load_booking_action_source(p_organization_id uuid, p_ai_message_run_id uuid)
returns table (id uuid, organization_id uuid, conversation_id uuid, status text, decision jsonb)
language sql stable security definer set search_path = '' as $$
  select run.id, run.organization_id, run.conversation_id, run.status, run.decision
  from public.ai_message_runs as run
  where run.id = p_ai_message_run_id and run.organization_id = p_organization_id
    and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required';
$$;

create function public.find_booking_mutation_execution(p_organization_id uuid, p_ai_message_run_id uuid)
returns table (execution_id uuid, execution_state text, terminal_result jsonb)
language sql stable security definer set search_path = '' as $$
  select execution.id, execution.state, execution.terminal_result
  from public.booking_mutation_executions as execution
  where execution.organization_id = p_organization_id
    and execution.source_ai_message_run_id = p_ai_message_run_id;
$$;

create function public.get_ai_booking_whatsapp_context(p_organization_id uuid, p_ai_message_run_id uuid)
returns table (primary_language text, dispatch_id uuid, state text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  select configuration.primary_language::text, dispatch.id, dispatch.state
  from public.ai_message_runs as run
  join public.conversations as conversation on conversation.id = run.conversation_id
    and conversation.organization_id = run.organization_id and conversation.channel = 'whatsapp'
  join public.whatsapp_channel_connections as connection on connection.id = conversation.channel_connection_id
    and connection.organization_id = run.organization_id
  left join public.ai_manager_configurations as configuration on configuration.organization_id = run.organization_id
  left join public.whatsapp_outbound_dispatches as dispatch on dispatch.source_ai_message_run_id = run.id
  where run.id = p_ai_message_run_id and run.organization_id = p_organization_id
    and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required'
    and (
      (dispatch.id is null and connection.status = 'active') or
      (dispatch.organization_id = run.organization_id and dispatch.conversation_id = conversation.id
        and dispatch.connection_id = connection.id
        and (dispatch.state <> 'prepared' or connection.status = 'active'))
    );
  if not found then raise exception 'Booking WhatsApp context unavailable' using errcode = '22023'; end if;
end;
$$;

create function public.prepare_ai_booking_whatsapp_dispatch(
  p_organization_id uuid, p_ai_message_run_id uuid, p_text text
)
returns table (dispatch_id uuid, state text)
language plpgsql security definer set search_path = '' as $$
declare
  source_conversation_id uuid;
  source_connection_id uuid;
  existing_id uuid;
  existing_state text;
begin
  if p_text is null or char_length(p_text) not between 1 and 2000 or p_text <> btrim(p_text) then
    raise exception 'Invalid booking WhatsApp response' using errcode = '22023';
  end if;
  -- Same lock order as reply preparation / booking mutation preparation.
  select run.conversation_id, conversation.channel_connection_id
  into source_conversation_id, source_connection_id
  from public.ai_message_runs as run
  join public.conversations as conversation on conversation.id = run.conversation_id
    and conversation.organization_id = run.organization_id and conversation.channel = 'whatsapp'
  where run.id = p_ai_message_run_id and run.organization_id = p_organization_id
    and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required'
  for update of run for share of conversation;
  if not found then raise exception 'Booking WhatsApp source unavailable' using errcode = '22023'; end if;

  select context.dispatch_id, context.state into existing_id, existing_state
  from public.get_ai_booking_whatsapp_context(p_organization_id, p_ai_message_run_id) as context;
  if existing_id is not null then
    return query select existing_id, existing_state;
    return;
  end if;
  -- Do not freeze a response while a create is still in flight. If terminal
  -- persistence was lost, stale mutation quarantine supplies the safe outcome.
  if exists (select 1 from public.booking_mutation_executions as execution
    where execution.source_ai_message_run_id = p_ai_message_run_id
      and execution.state in ('prepared', 'executing')) then
    raise exception 'Booking result not yet durable' using errcode = '22023';
  end if;
  perform 1 from public.whatsapp_channel_connections as connection
  where connection.id = source_connection_id and connection.organization_id = p_organization_id
    and connection.status = 'active' for share;
  if not found then raise exception 'Booking WhatsApp connection unavailable' using errcode = '22023'; end if;

  insert into public.whatsapp_outbound_dispatches
    (organization_id, conversation_id, connection_id, text_content, state, source_ai_message_run_id)
  values (p_organization_id, source_conversation_id, source_connection_id, p_text, 'prepared', p_ai_message_run_id)
  on conflict (source_ai_message_run_id) do nothing;
  return query select dispatch.id, dispatch.state from public.whatsapp_outbound_dispatches as dispatch
    where dispatch.source_ai_message_run_id = p_ai_message_run_id and dispatch.organization_id = p_organization_id;
end;
$$;

create function public.list_actionable_ai_booking_whatsapp_executions(p_limit integer)
returns table (organization_id uuid, ai_message_run_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid booking recovery limit' using errcode = '22023';
  end if;
  return query
  select run.organization_id, run.id
  from public.ai_message_runs as run
  join public.conversations as conversation on conversation.id = run.conversation_id
    and conversation.organization_id = run.organization_id and conversation.channel = 'whatsapp'
  join public.whatsapp_channel_connections as connection on connection.id = conversation.channel_connection_id
    and connection.organization_id = run.organization_id
  left join public.whatsapp_outbound_dispatches as dispatch on dispatch.source_ai_message_run_id = run.id
  left join public.booking_mutation_executions as execution on execution.source_ai_message_run_id = run.id
  where run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required'
    and (
      (dispatch.id is null and connection.status = 'active'
        and (execution.id is null or (execution.organization_id = run.organization_id and execution.state <> 'executing')))
      or
      (dispatch.organization_id = run.organization_id and dispatch.conversation_id = conversation.id
        and dispatch.connection_id = connection.id
        and ((dispatch.state = 'prepared' and connection.status = 'active') or dispatch.state = 'provider_accepted'))
    )
  order by run.updated_at, run.id limit p_limit;
end;
$$;

create index ai_message_runs_booking_response_recovery_idx on public.ai_message_runs(updated_at, id)
  where status = 'decided' and decision ->> 'action' = 'booking_action_required';

revoke all on function public.load_booking_action_source(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.find_booking_mutation_execution(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_ai_booking_whatsapp_context(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.prepare_ai_booking_whatsapp_dispatch(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.list_actionable_ai_booking_whatsapp_executions(integer) from public, anon, authenticated, service_role;
grant execute on function public.load_booking_action_source(uuid, uuid) to service_role;
grant execute on function public.find_booking_mutation_execution(uuid, uuid) to service_role;
grant execute on function public.get_ai_booking_whatsapp_context(uuid, uuid) to service_role;
grant execute on function public.prepare_ai_booking_whatsapp_dispatch(uuid, uuid, text) to service_role;
grant execute on function public.list_actionable_ai_booking_whatsapp_executions(integer) to service_role;

create or replace function public.claim_ai_reply_whatsapp_dispatch_execution(
  p_organization_id uuid,
  p_ai_message_run_id uuid
)
returns table (
  outcome text,
  dispatch_id uuid,
  phone_number_id text,
  recipient_wa_id text,
  text text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bound_dispatch_id uuid;
  bound_dispatch_state text;
  bound_phone_number_id text;
  bound_recipient_wa_id text;
  bound_text text;
  claim_outcome text;
begin
  if p_organization_id is null or p_ai_message_run_id is null then
    raise exception 'invalid AI reply WhatsApp execution claim'
      using errcode = '22023';
  end if;

  select
    dispatch.id,
    dispatch.state,
    connection.phone_number_id,
    conversation.external_participant_id,
    dispatch.text_content
  into
    bound_dispatch_id,
    bound_dispatch_state,
    bound_phone_number_id,
    bound_recipient_wa_id,
    bound_text
  from public.whatsapp_outbound_dispatches as dispatch
  join public.ai_message_runs as run
    on run.id = dispatch.source_ai_message_run_id
  join public.conversations as conversation
    on conversation.id = dispatch.conversation_id
  join public.whatsapp_channel_connections as connection
    on connection.id = dispatch.connection_id
  where dispatch.source_ai_message_run_id = p_ai_message_run_id
    and dispatch.organization_id = p_organization_id
    and run.id = p_ai_message_run_id
    and run.organization_id = p_organization_id
    and run.status = 'decided'
    and jsonb_typeof(run.decision) = 'object'
    and run.decision ->> 'action' in ('reply', 'booking_action_required')
    and run.conversation_id = conversation.id
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and connection.organization_id = p_organization_id
    and connection.id = conversation.channel_connection_id
    and connection.status = 'active'
    and conversation.external_participant_id is not null
    and char_length(conversation.external_participant_id) between 1 and 64
    and conversation.external_participant_id ~ '^[0-9]+$'
    and connection.phone_number_id is not null
    and char_length(connection.phone_number_id) between 1 and 64
    and connection.phone_number_id ~ '^[0-9]+$'
    and char_length(dispatch.text_content) between 1 and 2000
    and dispatch.text_content = btrim(dispatch.text_content)
  for update of dispatch
  for share of run, conversation, connection;

  if not found then
    raise exception 'AI reply WhatsApp execution source is unavailable'
      using errcode = '22023';
  end if;

  if bound_dispatch_state = 'prepared' then
    update public.whatsapp_outbound_dispatches as dispatch
    set
      state = 'dispatching',
      updated_at = clock_timestamp()
    where dispatch.id = bound_dispatch_id
      and dispatch.state = 'prepared';

    if not found then
      raise exception 'AI reply WhatsApp execution claim failed'
        using errcode = 'P0001';
    end if;

    claim_outcome := 'claimed';
  elsif bound_dispatch_state = 'dispatching' then
    claim_outcome := 'already_dispatching';
  elsif bound_dispatch_state in (
    'provider_accepted',
    'persisted',
    'indeterminate'
  ) then
    claim_outcome := bound_dispatch_state;
  else
    raise exception 'AI reply WhatsApp dispatch has an invalid state'
      using errcode = 'P0001';
  end if;

  return query
    select
      claim_outcome,
      bound_dispatch_id,
      case when claim_outcome = 'claimed' then bound_phone_number_id else null end,
      case when claim_outcome = 'claimed' then bound_recipient_wa_id else null end,
      case when claim_outcome = 'claimed' then bound_text else null end;
end;
$$;

revoke all
on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid)
to service_role;

comment on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid) is
  'Atomically grants exactly one automatic executor the immutable server-only send context for a prepared AI-bound WhatsApp dispatch.';
