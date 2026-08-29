alter table public.ai_message_runs
  drop constraint ai_message_runs_processing_state;

alter table public.ai_message_runs
  add constraint ai_message_runs_processing_state
  check (
    (
      status = 'pending'
      and attempt_count >= 0
      and processing_started_at is null
    )
    or (
      status in ('processing', 'decided', 'blocked', 'failed')
      and attempt_count >= 1
      and processing_started_at is not null
    )
  );

create index ai_message_runs_processing_started_idx
  on public.ai_message_runs (processing_started_at, id)
  where status = 'processing';

create function public.recover_stale_ai_message_runs(
  p_limit integer
)
returns table (
  retryable jsonb,
  exhausted_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_timestamp timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid AI message run recovery limit'
      using errcode = '22023';
  end if;

  return query
  with stale_runs as materialized (
    select
      run.id,
      run.attempt_count,
      run.processing_started_at
    from public.ai_message_runs as run
    where run.status = 'processing'
      and run.processing_started_at
        <= operation_timestamp - interval '10 minutes'
    order by run.processing_started_at, run.id
    limit p_limit
    for update skip locked
  ),
  recovered_runs as (
    update public.ai_message_runs as run
    set
      status = case
        when stale_run.attempt_count < 3 then 'pending'
        else 'failed'
      end,
      decision = null,
      failure_reason = case
        when stale_run.attempt_count < 3 then null
        else 'recovery_attempts_exhausted'
      end,
      processing_started_at = case
        when stale_run.attempt_count < 3 then null
        else run.processing_started_at
      end,
      updated_at = operation_timestamp
    from stale_runs as stale_run
    where run.id = stale_run.id
      and run.status = 'processing'
      and run.processing_started_at = stale_run.processing_started_at
    returning
      run.id,
      run.organization_id,
      run.conversation_id,
      run.trigger_message_id,
      run.attempt_count,
      run.status,
      stale_run.processing_started_at as stale_processing_started_at
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'organization_id', recovered_run.organization_id,
          'conversation_id', recovered_run.conversation_id,
          'trigger_message_id', recovered_run.trigger_message_id,
          'attempt_count', recovered_run.attempt_count
        )
        order by
          recovered_run.stale_processing_started_at,
          recovered_run.id
      ) filter (where recovered_run.status = 'pending'),
      '[]'::jsonb
    ),
    count(*) filter (
      where recovered_run.status = 'failed'
    )::integer
  from recovered_runs as recovered_run;
end;
$$;

revoke all
on function public.recover_stale_ai_message_runs(integer)
from public, anon, authenticated, service_role;

grant execute
on function public.recover_stale_ai_message_runs(integer)
to service_role;

comment on function public.recover_stale_ai_message_runs(integer) is
  'Atomically requeues stale AI processing attempts below the limit and safely exhausts attempt three without returning customer or provider data.';
