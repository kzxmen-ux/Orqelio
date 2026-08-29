create function public.quarantine_stale_ai_reply_whatsapp_dispatches(
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
    raise exception 'invalid stale AI reply WhatsApp quarantine limit'
      using errcode = '22023';
  end if;

  with stale_dispatches as materialized (
    select dispatch.id
    from public.whatsapp_outbound_dispatches as dispatch
    where dispatch.source_ai_message_run_id is not null
      and dispatch.state = 'dispatching'
      and dispatch.updated_at <= operation_timestamp - interval '10 minutes'
    order by dispatch.updated_at, dispatch.id
    limit p_limit
    for update skip locked
  ),
  quarantined as (
    update public.whatsapp_outbound_dispatches as dispatch
    set
      state = 'indeterminate',
      updated_at = operation_timestamp
    from stale_dispatches as stale_dispatch
    where dispatch.id = stale_dispatch.id
      and dispatch.source_ai_message_run_id is not null
      and dispatch.state = 'dispatching'
      and dispatch.updated_at <= operation_timestamp - interval '10 minutes'
    returning 1
  )
  select count(*)::integer
  into affected_count
  from quarantined;

  return query select affected_count;
end;
$$;

revoke all
on function public.quarantine_stale_ai_reply_whatsapp_dispatches(integer)
from public, anon, authenticated, service_role;

grant execute
on function public.quarantine_stale_ai_reply_whatsapp_dispatches(integer)
to service_role;

comment on function public.quarantine_stale_ai_reply_whatsapp_dispatches(integer) is
  'Quarantines bounded stale AI-bound dispatching rows as indeterminate without exposing identities or creating a resend path.';
