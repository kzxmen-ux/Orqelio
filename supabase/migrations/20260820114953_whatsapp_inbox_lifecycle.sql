create function webhook_private.claim_whatsapp_webhook_event_internal(
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

revoke all
on function webhook_private.claim_whatsapp_webhook_event_internal(uuid)
from public, anon, authenticated;

grant execute
on function webhook_private.claim_whatsapp_webhook_event_internal(uuid)
to service_role;

create function webhook_private.complete_whatsapp_webhook_event_internal(
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

revoke all
on function webhook_private.complete_whatsapp_webhook_event_internal(uuid)
from public, anon, authenticated;

grant execute
on function webhook_private.complete_whatsapp_webhook_event_internal(uuid)
to service_role;

create function webhook_private.fail_whatsapp_webhook_event_internal(
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

revoke all
on function webhook_private.fail_whatsapp_webhook_event_internal(uuid, text)
from public, anon, authenticated;

grant execute
on function webhook_private.fail_whatsapp_webhook_event_internal(uuid, text)
to service_role;

create function public.claim_whatsapp_webhook_event(p_event_id uuid)
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

revoke all
on function public.claim_whatsapp_webhook_event(uuid)
from public, anon, authenticated;

grant execute
on function public.claim_whatsapp_webhook_event(uuid)
to service_role;

create function public.complete_whatsapp_webhook_event(p_event_id uuid)
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

revoke all
on function public.complete_whatsapp_webhook_event(uuid)
from public, anon, authenticated;

grant execute
on function public.complete_whatsapp_webhook_event(uuid)
to service_role;

create function public.fail_whatsapp_webhook_event(
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

revoke all
on function public.fail_whatsapp_webhook_event(uuid, text)
from public, anon, authenticated;

grant execute
on function public.fail_whatsapp_webhook_event(uuid, text)
to service_role;

comment on function public.claim_whatsapp_webhook_event(uuid)
is 'Atomically transitions one WhatsApp inbox event from pending to processing.';

comment on function public.complete_whatsapp_webhook_event(uuid)
is 'Transitions one claimed WhatsApp inbox event from processing to processed.';

comment on function public.fail_whatsapp_webhook_event(uuid, text)
is 'Transitions one claimed WhatsApp inbox event from processing to failed with a bounded safe error code.';
