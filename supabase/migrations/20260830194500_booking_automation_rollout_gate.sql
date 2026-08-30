-- Server-controlled rollout; no row or NULL activated_at means disabled.
-- Keep separate from browser-editable organizations/configuration permissions.
create table private.booking_automation_rollouts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  activated_at timestamptz default null,
  constraint booking_automation_rollouts_finite_activation
    check (activated_at is null or isfinite(activated_at))
);
alter table private.booking_automation_rollouts enable row level security;
alter table private.booking_automation_rollouts force row level security;
revoke all on private.booking_automation_rollouts from public, anon, authenticated, service_role;
grant select, insert, update on private.booking_automation_rollouts to service_role;

-- Pure predicate permits read-only boundary tests, without activating tenants.
create function private.booking_activation_allows_run(p_activated_at timestamptz, p_created_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(isfinite(p_activated_at) and isfinite(p_created_at)
    and p_created_at >= p_activated_at, false);
$$;
revoke all on function private.booking_activation_allows_run(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function public.booking_automation_allows_run(p_organization_id uuid, p_ai_message_run_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ai_message_runs as run
    join private.booking_automation_rollouts as rollout on rollout.organization_id = run.organization_id
    where run.id = p_ai_message_run_id and run.organization_id = p_organization_id
      and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required'
      and private.booking_activation_allows_run(rollout.activated_at, run.created_at)
  );
$$;
revoke all on function public.booking_automation_allows_run(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.booking_automation_allows_run(uuid, uuid) to service_role;

comment on table private.booking_automation_rollouts is
  'Server-managed opt-in. Missing row/NULL disables automation. Set activated_at to the activation instant, never backdate to replay historical AI runs. No organizations are activated by this migration.';

create or replace function public.load_booking_action_source(p_organization_id uuid, p_ai_message_run_id uuid)
returns table (id uuid, organization_id uuid, conversation_id uuid, status text, decision jsonb)
language sql stable security definer set search_path = '' as $$
  select run.id, run.organization_id, run.conversation_id, run.status, run.decision
  from public.ai_message_runs as run
  where public.booking_automation_allows_run(p_organization_id, p_ai_message_run_id)
    and run.id = p_ai_message_run_id and run.organization_id = p_organization_id
    and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required';
$$;

create or replace function public.get_ai_booking_whatsapp_context(p_organization_id uuid, p_ai_message_run_id uuid)
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
  where public.booking_automation_allows_run(p_organization_id, p_ai_message_run_id)
    and run.id = p_ai_message_run_id and run.organization_id = p_organization_id
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

create or replace function public.list_actionable_ai_booking_whatsapp_executions(p_limit integer)
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
  where public.booking_automation_allows_run(run.organization_id, run.id)
    and run.status = 'decided' and run.decision ->> 'action' = 'booking_action_required'
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
    and (run.decision ->> 'action' = 'reply'
      or (run.decision ->> 'action' = 'booking_action_required' and public.booking_automation_allows_run(p_organization_id, p_ai_message_run_id)))
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

create or replace function public.claim_booking_mutation_execution(
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

  if not public.booking_automation_allows_run(p_organization_id, p_ai_message_run_id) then
    raise exception 'booking automation unavailable' using errcode = '22023';
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
