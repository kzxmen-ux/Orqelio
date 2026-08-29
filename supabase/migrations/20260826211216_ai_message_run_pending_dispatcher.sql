alter table public.ai_message_runs
  add constraint ai_message_runs_attempt_count_max
  check (attempt_count <= 3);

create or replace function public.claim_ai_message_run(
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
    and run.attempt_count < 3
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

  if claimed_run_status = 'pending' and claimed_attempt_count >= 3 then
    raise exception 'AI message run attempt limit reached'
      using errcode = '22023';
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

create function public.list_pending_ai_message_runs(
  p_limit integer
)
returns table (
  organization_id uuid,
  conversation_id uuid,
  trigger_message_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid pending AI message run limit'
      using errcode = '22023';
  end if;

  return query
  select
    run.organization_id,
    run.conversation_id,
    run.trigger_message_id,
    run.attempt_count
  from public.ai_message_runs as run
  where run.status = 'pending'
    and run.attempt_count < 3
  order by run.updated_at, run.id
  limit p_limit;
end;
$$;

revoke all
on function public.claim_ai_message_run(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

revoke all
on function public.list_pending_ai_message_runs(integer)
from public, anon, authenticated, service_role;

grant execute
on function public.claim_ai_message_run(uuid, uuid, uuid)
to service_role;

grant execute
on function public.list_pending_ai_message_runs(integer)
to service_role;

comment on function public.claim_ai_message_run(uuid, uuid, uuid) is
  'Atomically validates tenant/message binding and grants at most three AI processing attempts per trigger message.';

comment on function public.list_pending_ai_message_runs(integer) is
  'Returns only bounded technical identifiers for durable pending AI work discovery; claim remains the concurrency authority.';
