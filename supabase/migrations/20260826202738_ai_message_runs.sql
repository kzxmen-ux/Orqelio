create table public.ai_message_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  conversation_id uuid not null
    references public.conversations (id) on delete restrict,
  trigger_message_id uuid not null
    references public.messages (id) on delete restrict,
  status text not null default 'pending',
  decision jsonb,
  failure_reason text,
  attempt_count integer not null default 0,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_message_runs_trigger_message_unique
    unique (trigger_message_id),
  constraint ai_message_runs_status
    check (status in ('pending', 'processing', 'decided', 'blocked', 'failed')),
  constraint ai_message_runs_attempt_count
    check (attempt_count >= 0),
  constraint ai_message_runs_processing_state
    check (
      (
        status = 'pending'
        and attempt_count = 0
        and processing_started_at is null
      )
      or (
        status <> 'pending'
        and attempt_count >= 1
        and processing_started_at is not null
      )
    ),
  constraint ai_message_runs_terminal_payload
    check (
      (
        status in ('pending', 'processing')
        and decision is null
        and failure_reason is null
      )
      or (
        status = 'decided'
        and decision is not null
        and jsonb_typeof(decision) = 'object'
        and decision ? 'action'
        and failure_reason is null
      )
      or (
        status in ('blocked', 'failed')
        and decision is null
        and failure_reason is not null
        and char_length(failure_reason) between 1 and 128
        and failure_reason = btrim(failure_reason)
      )
    ),
  constraint ai_message_runs_timestamp_order
    check (updated_at >= created_at)
);

create index ai_message_runs_organization_idx
  on public.ai_message_runs (organization_id);

create index ai_message_runs_conversation_idx
  on public.ai_message_runs (conversation_id);

create index ai_message_runs_status_updated_idx
  on public.ai_message_runs (status, updated_at);

alter table public.ai_message_runs enable row level security;
alter table public.ai_message_runs force row level security;

revoke all
on public.ai_message_runs
from public, anon, authenticated, service_role;

create function public.claim_ai_message_run(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_trigger_message_id uuid
)
returns table (
  outcome text,
  run_id uuid,
  run_status text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_timestamp timestamptz := clock_timestamp();
  bound_message_id uuid;
  claimed_run_id uuid;
  claimed_run_status text;
  claimed_attempt_count integer;
begin
  if p_organization_id is null
    or p_conversation_id is null
    or p_trigger_message_id is null
  then
    raise exception 'invalid AI message run claim'
      using errcode = '22023';
  end if;

  select message.id
  into bound_message_id
  from public.messages as message
  join public.conversations as conversation
    on conversation.id = message.conversation_id
  where message.id = p_trigger_message_id
    and message.organization_id = p_organization_id
    and message.conversation_id = p_conversation_id
    and message.channel = conversation.channel
    and message.direction = 'inbound'
    and message.message_type = 'text'
    and message.text_content is not null
    and conversation.id = p_conversation_id
    and conversation.organization_id = p_organization_id
  for key share of message, conversation;

  if not found then
    raise exception 'AI message run trigger is unavailable'
      using errcode = '22023';
  end if;

  insert into public.ai_message_runs (
    organization_id,
    conversation_id,
    trigger_message_id,
    status,
    decision,
    failure_reason,
    attempt_count,
    processing_started_at,
    created_at,
    updated_at
  )
  values (
    p_organization_id,
    p_conversation_id,
    bound_message_id,
    'pending',
    null,
    null,
    0,
    null,
    operation_timestamp,
    operation_timestamp
  )
  on conflict (trigger_message_id) do nothing;

  update public.ai_message_runs as run
  set
    status = 'processing',
    attempt_count = run.attempt_count + 1,
    processing_started_at = operation_timestamp,
    updated_at = operation_timestamp
  where run.trigger_message_id = p_trigger_message_id
    and run.status = 'pending'
  returning run.id, run.status, run.attempt_count
  into claimed_run_id, claimed_run_status, claimed_attempt_count;

  if found then
    return query
      select
        'claimed'::text,
        claimed_run_id,
        claimed_run_status,
        claimed_attempt_count;
    return;
  end if;

  select run.id, run.status, run.attempt_count
  into claimed_run_id, claimed_run_status, claimed_attempt_count
  from public.ai_message_runs as run
  where run.trigger_message_id = p_trigger_message_id;

  if not found then
    raise exception 'AI message run claim failed'
      using errcode = 'P0001';
  end if;

  if claimed_run_status in ('decided', 'blocked', 'failed') then
    return query
      select
        'already_terminal'::text,
        claimed_run_id,
        claimed_run_status,
        claimed_attempt_count;
    return;
  end if;

  if claimed_run_status = 'processing' then
    return query
      select
        'already_processing'::text,
        claimed_run_id,
        claimed_run_status,
        claimed_attempt_count;
    return;
  end if;

  raise exception 'AI message run has an invalid claim state'
    using errcode = 'P0001';
end;
$$;

create function public.complete_ai_message_run(
  p_run_id uuid,
  p_terminal_status text,
  p_decision jsonb,
  p_failure_reason text
)
returns table (
  outcome text,
  run_id uuid,
  run_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_timestamp timestamptz := clock_timestamp();
  stored_run_id uuid;
  stored_run_status text;
  decision_action text;
  decision_is_valid boolean := false;
begin
  if p_run_id is null
    or p_terminal_status is null
    or p_terminal_status not in ('decided', 'blocked', 'failed')
  then
    raise exception 'invalid AI message run terminal result'
      using errcode = '22023';
  end if;

  if p_terminal_status = 'decided' then
    if p_decision is null
      or jsonb_typeof(p_decision) <> 'object'
      or p_failure_reason is not null
    then
      raise exception 'invalid AI message run decided result'
        using errcode = '22023';
    end if;

    decision_action := p_decision ->> 'action';

    decision_is_valid := case decision_action
      when 'reply' then
        p_decision - array['action', 'text'] = '{}'::jsonb
        and jsonb_typeof(p_decision -> 'text') = 'string'
        and char_length(p_decision ->> 'text') between 1 and 2000
        and p_decision ->> 'text' = btrim(p_decision ->> 'text')
      when 'booking_action_required' then
        p_decision - array['action', 'bookingIntent'] = '{}'::jsonb
        and p_decision ->> 'bookingIntent' in (
          'check_availability',
          'create_appointment',
          'reschedule_appointment',
          'cancel_appointment'
        )
      when 'handoff' then
        p_decision - array['action', 'reasonCode', 'safeReason'] = '{}'::jsonb
        and jsonb_typeof(p_decision -> 'reasonCode') = 'string'
        and char_length(p_decision ->> 'reasonCode') between 1 and 128
        and p_decision ->> 'reasonCode' = btrim(p_decision ->> 'reasonCode')
        and jsonb_typeof(p_decision -> 'safeReason') = 'string'
        and char_length(p_decision ->> 'safeReason') between 1 and 512
        and p_decision ->> 'safeReason' = btrim(p_decision ->> 'safeReason')
      when 'no_safe_answer' then
        p_decision - array['action', 'reason'] = '{}'::jsonb
        and jsonb_typeof(p_decision -> 'reason') = 'string'
        and char_length(p_decision ->> 'reason') between 1 and 128
        and p_decision ->> 'reason' = btrim(p_decision ->> 'reason')
      else false
    end;

    if not coalesce(decision_is_valid, false) then
      raise exception 'invalid AI message run decision'
        using errcode = '22023';
    end if;
  else
    if p_decision is not null
      or p_failure_reason is null
      or char_length(p_failure_reason) not between 1 and 128
      or p_failure_reason <> btrim(p_failure_reason)
    then
      raise exception 'invalid AI message run failure result'
        using errcode = '22023';
    end if;
  end if;

  update public.ai_message_runs as run
  set
    status = p_terminal_status,
    decision = p_decision,
    failure_reason = p_failure_reason,
    updated_at = operation_timestamp
  where run.id = p_run_id
    and run.status = 'processing'
  returning run.id, run.status
  into stored_run_id, stored_run_status;

  if found then
    return query
      select 'stored'::text, stored_run_id, stored_run_status;
    return;
  end if;

  select run.id, run.status
  into stored_run_id, stored_run_status
  from public.ai_message_runs as run
  where run.id = p_run_id;

  if not found then
    raise exception 'AI message run is unavailable'
      using errcode = '22023';
  end if;

  if stored_run_status in ('decided', 'blocked', 'failed') then
    return query
      select 'already_terminal'::text, stored_run_id, stored_run_status;
    return;
  end if;

  raise exception 'AI message run is not processing'
    using errcode = '22023';
end;
$$;

revoke all
on function public.claim_ai_message_run(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke all
on function public.complete_ai_message_run(uuid, text, jsonb, text)
from public, anon, authenticated, service_role;

grant execute
on function public.claim_ai_message_run(uuid, uuid, uuid)
to service_role;

grant execute
on function public.complete_ai_message_run(uuid, text, jsonb, text)
to service_role;

comment on table public.ai_message_runs is
  'Server-owned provider-neutral ledger for one validated AI processing result per durable trigger message.';

comment on function public.claim_ai_message_run(uuid, uuid, uuid) is
  'Atomically validates tenant/message binding and grants exactly one active AI processor per trigger message.';

comment on function public.complete_ai_message_run(uuid, text, jsonb, text) is
  'Stores one immutable terminal AI decision or safe blocked/failed reason without raw provider data.';
