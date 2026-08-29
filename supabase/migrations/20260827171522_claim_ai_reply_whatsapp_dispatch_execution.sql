create function public.claim_ai_reply_whatsapp_dispatch_execution(
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
    and run.decision ->> 'action' = 'reply'
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

revoke all
on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid)
to service_role;

comment on function public.claim_ai_reply_whatsapp_dispatch_execution(uuid, uuid) is
  'Atomically grants exactly one automatic executor the immutable server-only send context for a prepared AI-bound WhatsApp dispatch.';
