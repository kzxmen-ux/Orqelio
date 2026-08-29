create table webhook_private.whatsapp_webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default clock_timestamp(),
  processing_status text not null default 'pending',
  raw_payload jsonb not null,
  payload_hash bytea not null,
  processed_at timestamptz,
  error_code text,
  constraint whatsapp_webhook_inbox_processing_status
    check (
      processing_status in (
        'pending',
        'processing',
        'processed',
        'failed'
      )
    ),
  constraint whatsapp_webhook_inbox_raw_payload_object
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint whatsapp_webhook_inbox_raw_payload_size
    check (octet_length(raw_payload::text) <= 262144),
  constraint whatsapp_webhook_inbox_payload_hash_size
    check (octet_length(payload_hash) = 32),
  constraint whatsapp_webhook_inbox_processing_result
    check (
      (
        processing_status in ('pending', 'processing')
        and processed_at is null
      )
      or (
        processing_status in ('processed', 'failed')
        and processed_at is not null
      )
    ),
  constraint whatsapp_webhook_inbox_pending_has_no_error
    check (processing_status <> 'pending' or error_code is null),
  constraint whatsapp_webhook_inbox_payload_hash_unique
    unique (payload_hash)
);

create index whatsapp_webhook_inbox_pending_received_idx
  on webhook_private.whatsapp_webhook_inbox (received_at)
  where processing_status = 'pending';

alter table webhook_private.whatsapp_webhook_inbox enable row level security;
alter table webhook_private.whatsapp_webhook_inbox force row level security;

revoke all
on webhook_private.whatsapp_webhook_inbox
from public, anon, authenticated, service_role;

create function webhook_private.store_whatsapp_webhook_event_internal(
  target_payload jsonb
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
  calculated_payload_hash bytea;
  inserted_event_id uuid;
begin
  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object'
    or target_payload ->> 'object' <> 'whatsapp_business_account'
    or jsonb_typeof(target_payload -> 'entry') <> 'array'
    or octet_length(target_payload::text) > 262144
  then
    raise exception 'invalid webhook payload' using errcode = '22023';
  end if;

  calculated_payload_hash := extensions.digest(
    convert_to(target_payload::text, 'UTF8'),
    'sha256'
  );

  insert into webhook_private.whatsapp_webhook_inbox (
    processing_status,
    raw_payload,
    payload_hash
  )
  values (
    'pending',
    target_payload,
    calculated_payload_hash
  )
  on conflict (payload_hash) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    select inbox.id
    into inserted_event_id
    from webhook_private.whatsapp_webhook_inbox as inbox
    where inbox.payload_hash = calculated_payload_hash;

    return query select 'duplicate'::text, inserted_event_id;
    return;
  end if;

  return query select 'accepted'::text, inserted_event_id;
end;
$$;

revoke all
on function webhook_private.store_whatsapp_webhook_event_internal(jsonb)
from public, anon, authenticated;

grant execute
on function webhook_private.store_whatsapp_webhook_event_internal(jsonb)
to service_role;

create function public.store_whatsapp_webhook_event(p_payload jsonb)
returns table (
  outcome text,
  event_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from webhook_private.store_whatsapp_webhook_event_internal(p_payload);
$$;

revoke all
on function public.store_whatsapp_webhook_event(jsonb)
from public, anon, authenticated;

grant execute
on function public.store_whatsapp_webhook_event(jsonb)
to service_role;

comment on table webhook_private.whatsapp_webhook_inbox is
  'Append-only WhatsApp webhook inbox. Browser roles have no privileges or RLS policies.';

comment on column webhook_private.whatsapp_webhook_inbox.raw_payload is
  'Validated, size-bounded Meta JSON. It may contain customer data and must never be exposed or logged.';

comment on function webhook_private.store_whatsapp_webhook_event_internal(jsonb)
is 'Validates the minimal Meta envelope and appends it with a canonical JSON SHA-256 deduplication hash.';
