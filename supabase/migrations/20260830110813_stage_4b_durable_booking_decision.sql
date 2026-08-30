create or replace function public.complete_ai_message_run(
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
  booking_request jsonb;
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
    booking_request := p_decision -> 'bookingRequest';

    decision_is_valid := case decision_action
      when 'reply' then
        p_decision - array['action', 'text'] = '{}'::jsonb
        and jsonb_typeof(p_decision -> 'text') = 'string'
        and char_length(p_decision ->> 'text') between 1 and 2000
        and p_decision ->> 'text' = btrim(p_decision ->> 'text')
      when 'booking_action_required' then
        p_decision - array[
          'action',
          'bookingIntent',
          'bookingRequest'
        ] = '{}'::jsonb
        and p_decision ->> 'bookingIntent' in (
          'check_availability',
          'create_appointment',
          'reschedule_appointment',
          'cancel_appointment'
        )
        and jsonb_typeof(booking_request) = 'object'
        and booking_request ?& array[
          'serviceQuery',
          'staffQuery',
          'dateText',
          'timeText',
          'customerName',
          'customerPhone',
          'appointmentReference'
        ]
        and booking_request - array[
          'serviceQuery',
          'staffQuery',
          'dateText',
          'timeText',
          'customerName',
          'customerPhone',
          'appointmentReference'
        ] = '{}'::jsonb
        and (
          booking_request -> 'serviceQuery' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'serviceQuery') = 'string'
            and char_length(booking_request ->> 'serviceQuery') between 1 and 500
            and booking_request ->> 'serviceQuery' = btrim(booking_request ->> 'serviceQuery')
          )
        )
        and (
          booking_request -> 'staffQuery' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'staffQuery') = 'string'
            and char_length(booking_request ->> 'staffQuery') between 1 and 500
            and booking_request ->> 'staffQuery' = btrim(booking_request ->> 'staffQuery')
          )
        )
        and (
          booking_request -> 'dateText' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'dateText') = 'string'
            and char_length(booking_request ->> 'dateText') between 1 and 500
            and booking_request ->> 'dateText' = btrim(booking_request ->> 'dateText')
          )
        )
        and (
          booking_request -> 'timeText' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'timeText') = 'string'
            and char_length(booking_request ->> 'timeText') between 1 and 500
            and booking_request ->> 'timeText' = btrim(booking_request ->> 'timeText')
          )
        )
        and (
          booking_request -> 'customerName' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'customerName') = 'string'
            and char_length(booking_request ->> 'customerName') between 1 and 500
            and booking_request ->> 'customerName' = btrim(booking_request ->> 'customerName')
          )
        )
        and (
          booking_request -> 'customerPhone' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'customerPhone') = 'string'
            and char_length(booking_request ->> 'customerPhone') between 1 and 500
            and booking_request ->> 'customerPhone' = btrim(booking_request ->> 'customerPhone')
          )
        )
        and (
          booking_request -> 'appointmentReference' = 'null'::jsonb
          or (
            jsonb_typeof(booking_request -> 'appointmentReference') = 'string'
            and char_length(booking_request ->> 'appointmentReference') between 1 and 500
            and booking_request ->> 'appointmentReference' = btrim(booking_request ->> 'appointmentReference')
          )
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
on function public.complete_ai_message_run(uuid, text, jsonb, text)
from public, anon, authenticated, service_role;

grant execute
on function public.complete_ai_message_run(uuid, text, jsonb, text)
to service_role;

comment on function public.complete_ai_message_run(uuid, text, jsonb, text) is
  'Stores one immutable terminal AI decision, including an exact validated semantic booking request, or a safe blocked/failed reason.';
