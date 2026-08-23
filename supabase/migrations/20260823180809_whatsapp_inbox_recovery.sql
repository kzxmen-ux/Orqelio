alter table webhook_private.whatsapp_webhook_inbox
  add column processing_started_at timestamptz,
  add column attempt_count integer not null default 0;

update webhook_private.whatsapp_webhook_inbox
set
  processing_started_at = case
    when processing_status = 'processing' then clock_timestamp()
    else null
  end,
  attempt_count = case
    when processing_status = 'processing' then 1
    else 0
  end;

alter table webhook_private.whatsapp_webhook_inbox
  add constraint whatsapp_webhook_inbox_attempt_count_check
    check (attempt_count >= 0),
  add constraint whatsapp_webhook_inbox_processing_started_at_check
    check (
      (processing_status = 'processing' and processing_started_at is not null)
      or
      (processing_status in ('pending', 'processed', 'failed') and processing_started_at is null)
    );

create index whatsapp_webhook_inbox_stale_processing_idx
on webhook_private.whatsapp_webhook_inbox (processing_started_at)
where processing_status = 'processing';

create or replace function webhook_private.claim_whatsapp_webhook_event_internal(
  target_event_id uuid
)
returns table (
  outcome text,
  event_id uuid,
  raw_payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_event_id uuid;
  claimed_raw_payload jsonb;
begin
  update webhook_private.whatsapp_webhook_inbox as inbox
  set
    processing_status = 'processing',
    processing_started_at = clock_timestamp(),
    attempt_count = inbox.attempt_count + 1,
    processed_at = null,
    error_code = null
  where inbox.id = target_event_id
    and inbox.processing_status = 'pending'
  returning inbox.id, inbox.raw_payload
  into claimed_event_id, claimed_raw_payload;

  if claimed_event_id is null then
    return query
    select 'unavailable'::text, target_event_id, null::jsonb;
    return;
  end if;

  return query
  select 'claimed'::text, claimed_event_id, claimed_raw_payload;
end;
$$;

create or replace function webhook_private.complete_whatsapp_webhook_event_internal(
  target_event_id uuid
)
returns table (
  outcome text,
  event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_event_id uuid;
begin
  update webhook_private.whatsapp_webhook_inbox as inbox
  set
    processing_status = 'processed',
    processing_started_at = null,
    processed_at = clock_timestamp(),
    error_code = null
  where inbox.id = target_event_id
    and inbox.processing_status = 'processing'
  returning inbox.id into completed_event_id;

  if completed_event_id is null then
    raise exception 'webhook event is not processing' using errcode = '55000';
  end if;

  return query select 'completed'::text, completed_event_id;
end;
$$;

create or replace function webhook_private.fail_whatsapp_webhook_event_internal(
  target_event_id uuid,
  target_error_code text
)
returns table (
  outcome text,
  event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_event_id uuid;
begin
  if target_error_code is null
    or target_error_code <> btrim(target_error_code)
    or char_length(target_error_code) not between 1 and 64
    or target_error_code !~ '^[a-z0-9][a-z0-9._:-]*$'
  then
    raise exception 'invalid webhook error code' using errcode = '22023';
  end if;

  update webhook_private.whatsapp_webhook_inbox as inbox
  set
    processing_status = 'failed',
    processing_started_at = null,
    processed_at = clock_timestamp(),
    error_code = target_error_code
  where inbox.id = target_event_id
    and inbox.processing_status = 'processing'
  returning inbox.id into failed_event_id;

  if failed_event_id is null then
    raise exception 'webhook event is not processing' using errcode = '55000';
  end if;

  return query select 'failed'::text, failed_event_id;
end;
$$;

create function webhook_private.recover_whatsapp_webhook_inbox_internal(
  target_limit integer
)
returns table (event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_limit integer := least(50, greatest(1, coalesce(target_limit, 25)));
  recovery_time timestamptz := clock_timestamp();
begin
  update webhook_private.whatsapp_webhook_inbox as inbox
  set
    processing_status = case
      when inbox.attempt_count < 5 then 'pending'
      else 'failed'
    end,
    processing_started_at = null,
    processed_at = case
      when inbox.attempt_count < 5 then null
      else recovery_time
    end,
    error_code = case
      when inbox.attempt_count < 5 then null
      else 'recovery_attempts_exhausted'
    end
  where inbox.processing_status = 'processing'
    and inbox.processing_started_at <= recovery_time - interval '10 minutes';

  return query
  select inbox.id
  from webhook_private.whatsapp_webhook_inbox as inbox
  where inbox.processing_status = 'pending'
    and inbox.received_at <= recovery_time - interval '1 minute'
  order by inbox.received_at, inbox.id
  limit bounded_limit;
end;
$$;

revoke all
on function webhook_private.claim_whatsapp_webhook_event_internal(uuid)
from public, anon, authenticated;

revoke all
on function webhook_private.complete_whatsapp_webhook_event_internal(uuid)
from public, anon, authenticated;

revoke all
on function webhook_private.fail_whatsapp_webhook_event_internal(uuid, text)
from public, anon, authenticated;

revoke all
on function webhook_private.recover_whatsapp_webhook_inbox_internal(integer)
from public, anon, authenticated;

grant execute
on function webhook_private.claim_whatsapp_webhook_event_internal(uuid)
to service_role;

grant execute
on function webhook_private.complete_whatsapp_webhook_event_internal(uuid)
to service_role;

grant execute
on function webhook_private.fail_whatsapp_webhook_event_internal(uuid, text)
to service_role;

grant execute
on function webhook_private.recover_whatsapp_webhook_inbox_internal(integer)
to service_role;

create or replace function public.claim_whatsapp_webhook_event(p_event_id uuid)
returns table (
  outcome text,
  event_id uuid,
  raw_payload jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from webhook_private.claim_whatsapp_webhook_event_internal(p_event_id);
$$;

create or replace function public.complete_whatsapp_webhook_event(p_event_id uuid)
returns table (
  outcome text,
  event_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from webhook_private.complete_whatsapp_webhook_event_internal(p_event_id);
$$;

create or replace function public.fail_whatsapp_webhook_event(
  p_event_id uuid,
  p_error_code text
)
returns table (
  outcome text,
  event_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from webhook_private.fail_whatsapp_webhook_event_internal(
    p_event_id,
    p_error_code
  );
$$;

create function public.recover_whatsapp_webhook_inbox(
  p_limit integer default 25
)
returns table (event_id uuid)
language sql
security invoker
set search_path = ''
as $$
  select *
  from webhook_private.recover_whatsapp_webhook_inbox_internal(p_limit);
$$;

revoke all
on function public.claim_whatsapp_webhook_event(uuid)
from public, anon, authenticated;

revoke all
on function public.complete_whatsapp_webhook_event(uuid)
from public, anon, authenticated;

revoke all
on function public.fail_whatsapp_webhook_event(uuid, text)
from public, anon, authenticated;

revoke all
on function public.recover_whatsapp_webhook_inbox(integer)
from public, anon, authenticated;

grant execute
on function public.claim_whatsapp_webhook_event(uuid)
to service_role;

grant execute
on function public.complete_whatsapp_webhook_event(uuid)
to service_role;

grant execute
on function public.fail_whatsapp_webhook_event(uuid, text)
to service_role;

grant execute
on function public.recover_whatsapp_webhook_inbox(integer)
to service_role;

comment on column webhook_private.whatsapp_webhook_inbox.processing_started_at
is 'Timestamp of the current processing attempt; cleared outside processing state.';

comment on column webhook_private.whatsapp_webhook_inbox.attempt_count
is 'Number of successful pending-to-processing claims.';

comment on function public.recover_whatsapp_webhook_inbox(integer)
is 'Requeues stale WhatsApp inbox events, exhausts repeated attempts, and returns only eligible event IDs.';
