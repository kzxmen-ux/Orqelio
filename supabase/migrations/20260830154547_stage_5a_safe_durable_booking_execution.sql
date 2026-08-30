create table public.booking_mutation_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  conversation_id uuid not null
    references public.conversations (id) on delete restrict,
  source_ai_message_run_id uuid not null
    references public.ai_message_runs (id) on delete restrict,
  trusted_request jsonb not null,
  state text not null default 'prepared',
  terminal_result jsonb,
  executing_started_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_mutation_executions_source_run_unique
    unique (source_ai_message_run_id),
  constraint booking_mutation_executions_state
    check (state in (
      'prepared',
      'executing',
      'succeeded',
      'failed',
      'indeterminate'
    )),
  constraint booking_mutation_executions_trusted_request
    check (
      jsonb_typeof(trusted_request) = 'object'
      and trusted_request ?& array[
        'intent',
        'serviceId',
        'staffId',
        'startAt',
        'customer'
      ]
      and trusted_request - array[
        'intent',
        'serviceId',
        'staffId',
        'startAt',
        'customer'
      ] = '{}'::jsonb
      and trusted_request ->> 'intent' = 'create_appointment'
      and jsonb_typeof(trusted_request -> 'serviceId') = 'string'
      and char_length(trusted_request ->> 'serviceId') between 1 and 255
      and trusted_request ->> 'serviceId' = btrim(trusted_request ->> 'serviceId')
      and jsonb_typeof(trusted_request -> 'staffId') = 'string'
      and char_length(trusted_request ->> 'staffId') between 1 and 255
      and trusted_request ->> 'staffId' = btrim(trusted_request ->> 'staffId')
      and jsonb_typeof(trusted_request -> 'startAt') = 'string'
      and char_length(trusted_request ->> 'startAt') between 1 and 64
      and trusted_request ->> 'startAt' = btrim(trusted_request ->> 'startAt')
      and jsonb_typeof(trusted_request -> 'customer') = 'object'
      and (trusted_request -> 'customer') ?& array['name', 'phone']
      and (trusted_request -> 'customer') - array['name', 'phone'] = '{}'::jsonb
      and jsonb_typeof(trusted_request -> 'customer' -> 'name') = 'string'
      and char_length(trusted_request -> 'customer' ->> 'name') between 1 and 500
      and trusted_request -> 'customer' ->> 'name'
        = btrim(trusted_request -> 'customer' ->> 'name')
      and jsonb_typeof(trusted_request -> 'customer' -> 'phone') = 'string'
      and trusted_request -> 'customer' ->> 'phone' ~ '^[0-9]{1,32}$'
    ),
  constraint booking_mutation_executions_terminal_result
    check (
      (
        state in ('prepared', 'executing')
        and terminal_result is null
        and terminal_at is null
      )
      or (
        state = 'succeeded'
        and terminal_at is not null
        and jsonb_typeof(terminal_result) = 'object'
        and terminal_result ?& array['success', 'data']
        and terminal_result - array['success', 'data'] = '{}'::jsonb
        and terminal_result -> 'success' = 'true'::jsonb
        and jsonb_typeof(terminal_result -> 'data') = 'object'
        and (terminal_result -> 'data') ?& array[
          'id',
          'serviceId',
          'staffId',
          'startAt',
          'endAt',
          'status'
        ]
        and (terminal_result -> 'data') - array[
          'id',
          'serviceId',
          'staffId',
          'startAt',
          'endAt',
          'status'
        ] = '{}'::jsonb
        and jsonb_typeof(terminal_result -> 'data' -> 'id') = 'string'
        and char_length(terminal_result -> 'data' ->> 'id') between 1 and 255
        and terminal_result -> 'data' ->> 'id'
          = btrim(terminal_result -> 'data' ->> 'id')
        and terminal_result -> 'data' ->> 'serviceId'
          = trusted_request ->> 'serviceId'
        and terminal_result -> 'data' ->> 'staffId'
          = trusted_request ->> 'staffId'
        and terminal_result -> 'data' ->> 'startAt'
          = trusted_request ->> 'startAt'
        and jsonb_typeof(terminal_result -> 'data' -> 'endAt') = 'string'
        and char_length(terminal_result -> 'data' ->> 'endAt') between 1 and 64
        and terminal_result -> 'data' ->> 'endAt'
          = btrim(terminal_result -> 'data' ->> 'endAt')
        and terminal_result -> 'data' ->> 'status' = 'confirmed'
      )
      or (
        state = 'failed'
        and terminal_at is not null
        and jsonb_typeof(terminal_result) = 'object'
        and terminal_result ?& array['success', 'code', 'retryable']
        and terminal_result - array['success', 'code', 'retryable'] = '{}'::jsonb
        and terminal_result -> 'success' = 'false'::jsonb
        and terminal_result ->> 'code' in (
          'invalid_request',
          'connection_unavailable',
          'provider_unavailable',
          'not_found',
          'slot_unavailable',
          'operation_not_supported'
        )
        and jsonb_typeof(terminal_result -> 'retryable') = 'boolean'
      )
      or (
        state = 'indeterminate'
        and terminal_at is not null
        and terminal_result = jsonb_build_object(
          'success', false,
          'code', 'provider_error',
          'retryable', false
        )
      )
    ),
  constraint booking_mutation_executions_execution_timestamp
    check (
      (state = 'prepared' and executing_started_at is null)
      or (state <> 'prepared' and executing_started_at is not null)
    ),
  constraint booking_mutation_executions_timestamp_order
    check (
      updated_at >= created_at
      and (executing_started_at is null or executing_started_at >= created_at)
      and (terminal_at is null or terminal_at >= executing_started_at)
    )
);

create index booking_mutation_executions_organization_idx
  on public.booking_mutation_executions (organization_id);

create index booking_mutation_executions_stale_idx
  on public.booking_mutation_executions (updated_at, id)
  where state = 'executing';

alter table public.booking_mutation_executions enable row level security;
alter table public.booking_mutation_executions force row level security;

revoke all
on public.booking_mutation_executions
from public, anon, authenticated, service_role;

create function public.prepare_booking_mutation_execution(
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

create function public.claim_booking_mutation_execution(
  p_organization_id uuid,
  p_ai_message_run_id uuid
)
returns table (
  outcome text,
  execution_id uuid,
  trusted_request jsonb,
  terminal_result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_timestamp timestamptz := clock_timestamp();
  bound_execution_id uuid;
  bound_state text;
  bound_request jsonb;
  bound_terminal_result jsonb;
  claim_outcome text;
begin
  if p_organization_id is null or p_ai_message_run_id is null then
    raise exception 'invalid booking mutation claim'
      using errcode = '22023';
  end if;

  select execution.id, execution.state, execution.trusted_request,
    execution.terminal_result
  into bound_execution_id, bound_state, bound_request, bound_terminal_result
  from public.booking_mutation_executions as execution
  where execution.source_ai_message_run_id = p_ai_message_run_id
    and execution.organization_id = p_organization_id
  for update of execution;

  if not found then
    raise exception 'booking mutation execution is unavailable'
      using errcode = '22023';
  end if;

  if bound_state = 'prepared' then
    update public.booking_mutation_executions as execution
    set
      state = 'executing',
      executing_started_at = operation_timestamp,
      updated_at = operation_timestamp
    where execution.id = bound_execution_id
      and execution.state = 'prepared';

    if not found then
      raise exception 'booking mutation claim failed'
        using errcode = 'P0001';
    end if;

    claim_outcome := 'claimed';
  elsif bound_state = 'executing' then
    claim_outcome := 'already_executing';
  elsif bound_state in ('succeeded', 'failed', 'indeterminate') then
    claim_outcome := bound_state;
  else
    raise exception 'booking mutation execution has an invalid state'
      using errcode = 'P0001';
  end if;

  return query
    select
      claim_outcome,
      bound_execution_id,
      case when claim_outcome = 'claimed' then bound_request else null end,
      case
        when claim_outcome in ('succeeded', 'failed', 'indeterminate')
        then bound_terminal_result
        else null
      end;
end;
$$;

create function public.record_booking_mutation_success(
  p_organization_id uuid,
  p_execution_id uuid,
  p_terminal_result jsonb
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
  operation_timestamp timestamptz := clock_timestamp();
  stored_state text;
  stored_result jsonb;
begin
  update public.booking_mutation_executions as execution
  set
    state = 'succeeded',
    terminal_result = p_terminal_result,
    terminal_at = operation_timestamp,
    updated_at = operation_timestamp
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
    and execution.state = 'executing'
  returning execution.state, execution.terminal_result
  into stored_state, stored_result;

  if not found then
    select execution.state, execution.terminal_result
    into stored_state, stored_result
    from public.booking_mutation_executions as execution
    where execution.id = p_execution_id
      and execution.organization_id = p_organization_id;

    if not found
      or stored_state <> 'succeeded'
      or stored_result <> p_terminal_result
    then
      raise exception 'booking mutation success cannot be recorded'
        using errcode = '22023';
    end if;
  end if;

  return query select p_execution_id, stored_state, stored_result;
end;
$$;

create function public.record_booking_mutation_failure(
  p_organization_id uuid,
  p_execution_id uuid,
  p_terminal_result jsonb
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
  operation_timestamp timestamptz := clock_timestamp();
  stored_state text;
  stored_result jsonb;
begin
  update public.booking_mutation_executions as execution
  set
    state = 'failed',
    terminal_result = p_terminal_result,
    terminal_at = operation_timestamp,
    updated_at = operation_timestamp
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
    and execution.state = 'executing'
  returning execution.state, execution.terminal_result
  into stored_state, stored_result;

  if not found then
    select execution.state, execution.terminal_result
    into stored_state, stored_result
    from public.booking_mutation_executions as execution
    where execution.id = p_execution_id
      and execution.organization_id = p_organization_id;

    if not found
      or stored_state <> 'failed'
      or stored_result <> p_terminal_result
    then
      raise exception 'booking mutation failure cannot be recorded'
        using errcode = '22023';
    end if;
  end if;

  return query select p_execution_id, stored_state, stored_result;
end;
$$;

create function public.mark_booking_mutation_indeterminate(
  p_organization_id uuid,
  p_execution_id uuid
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
  operation_timestamp timestamptz := clock_timestamp();
  indeterminate_result jsonb := jsonb_build_object(
    'success', false,
    'code', 'provider_error',
    'retryable', false
  );
  stored_state text;
  stored_result jsonb;
begin
  update public.booking_mutation_executions as execution
  set
    state = 'indeterminate',
    terminal_result = indeterminate_result,
    terminal_at = operation_timestamp,
    updated_at = operation_timestamp
  where execution.id = p_execution_id
    and execution.organization_id = p_organization_id
    and execution.state = 'executing'
  returning execution.state, execution.terminal_result
  into stored_state, stored_result;

  if not found then
    select execution.state, execution.terminal_result
    into stored_state, stored_result
    from public.booking_mutation_executions as execution
    where execution.id = p_execution_id
      and execution.organization_id = p_organization_id;

    if not found or stored_state <> 'indeterminate' then
      raise exception 'booking mutation cannot be marked indeterminate'
        using errcode = '22023';
    end if;
  end if;

  return query select p_execution_id, stored_state, stored_result;
end;
$$;

create function public.quarantine_stale_booking_mutation_executions(
  p_limit integer
)
returns table (
  quarantined_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_timestamp timestamptz := clock_timestamp();
  affected_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid booking mutation quarantine limit'
      using errcode = '22023';
  end if;

  with stale_executions as materialized (
    select execution.id
    from public.booking_mutation_executions as execution
    where execution.state = 'executing'
      and execution.updated_at <= operation_timestamp - interval '10 minutes'
    order by execution.updated_at, execution.id
    limit p_limit
    for update skip locked
  ),
  quarantined as (
    update public.booking_mutation_executions as execution
    set
      state = 'indeterminate',
      terminal_result = jsonb_build_object(
        'success', false,
        'code', 'provider_error',
        'retryable', false
      ),
      terminal_at = operation_timestamp,
      updated_at = operation_timestamp
    from stale_executions as stale
    where execution.id = stale.id
      and execution.state = 'executing'
      and execution.updated_at <= operation_timestamp - interval '10 minutes'
    returning 1
  )
  select count(*)::integer into affected_count from quarantined;

  return query select affected_count;
end;
$$;

revoke all
on function public.prepare_booking_mutation_execution(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all
on function public.claim_booking_mutation_execution(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all
on function public.record_booking_mutation_success(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all
on function public.record_booking_mutation_failure(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
revoke all
on function public.mark_booking_mutation_indeterminate(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all
on function public.quarantine_stale_booking_mutation_executions(integer)
from public, anon, authenticated, service_role;

grant execute
on function public.prepare_booking_mutation_execution(uuid, uuid, jsonb)
to service_role;
grant execute
on function public.claim_booking_mutation_execution(uuid, uuid)
to service_role;
grant execute
on function public.record_booking_mutation_success(uuid, uuid, jsonb)
to service_role;
grant execute
on function public.record_booking_mutation_failure(uuid, uuid, jsonb)
to service_role;
grant execute
on function public.mark_booking_mutation_indeterminate(uuid, uuid)
to service_role;
grant execute
on function public.quarantine_stale_booking_mutation_executions(integer)
to service_role;

comment on table public.booking_mutation_executions is
  'Server-only exactly-once claim journal for trusted provider-neutral booking mutations.';
comment on function public.prepare_booking_mutation_execution(uuid, uuid, jsonb) is
  'Idempotently binds one terminal AI create decision to one immutable trusted request after validating WhatsApp customer identity.';
comment on function public.claim_booking_mutation_execution(uuid, uuid) is
  'Atomically grants one executor the immutable trusted create request; executing and terminal rows cannot be claimed again.';
comment on function public.quarantine_stale_booking_mutation_executions(integer) is
  'Quarantines stale executing booking mutations as indeterminate without creating a retry path.';
