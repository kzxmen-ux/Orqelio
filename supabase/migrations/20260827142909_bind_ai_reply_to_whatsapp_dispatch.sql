alter table public.whatsapp_outbound_dispatches
  add column source_ai_message_run_id uuid
    references public.ai_message_runs (id) on delete restrict;

alter table public.whatsapp_outbound_dispatches
  add constraint whatsapp_outbound_dispatches_source_ai_message_run_unique
  unique (source_ai_message_run_id);

create function public.prepare_ai_reply_whatsapp_dispatch(
  p_organization_id uuid,
  p_ai_message_run_id uuid
)
returns table (
  dispatch_id uuid,
  state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_conversation_id uuid;
  source_connection_id uuid;
  source_reply_text text;
  prepared_dispatch_id uuid;
  prepared_dispatch_state text;
begin
  if p_organization_id is null or p_ai_message_run_id is null then
    raise exception 'invalid AI reply WhatsApp dispatch'
      using errcode = '22023';
  end if;

  select
    run.conversation_id,
    connection.id,
    run.decision ->> 'text'
  into
    source_conversation_id,
    source_connection_id,
    source_reply_text
  from public.ai_message_runs as run
  join public.conversations as conversation
    on conversation.id = run.conversation_id
  join public.whatsapp_channel_connections as connection
    on connection.id = conversation.channel_connection_id
  where run.id = p_ai_message_run_id
    and run.organization_id = p_organization_id
    and run.status = 'decided'
    and jsonb_typeof(run.decision) = 'object'
    and run.decision ->> 'action' = 'reply'
    and run.decision - array['action', 'text'] = '{}'::jsonb
    and jsonb_typeof(run.decision -> 'text') = 'string'
    and char_length(run.decision ->> 'text') between 1 and 2000
    and run.decision ->> 'text' = btrim(run.decision ->> 'text')
    and conversation.organization_id = p_organization_id
    and conversation.channel = 'whatsapp'
    and connection.organization_id = p_organization_id
    and connection.status = 'active'
  for update of run
  for share of conversation, connection;

  if not found then
    raise exception 'AI reply WhatsApp dispatch source is unavailable'
      using errcode = '22023';
  end if;

  insert into public.whatsapp_outbound_dispatches (
    organization_id,
    conversation_id,
    connection_id,
    text_content,
    state,
    source_ai_message_run_id
  )
  values (
    p_organization_id,
    source_conversation_id,
    source_connection_id,
    source_reply_text,
    'prepared',
    p_ai_message_run_id
  )
  on conflict (source_ai_message_run_id) do nothing;

  select dispatch.id, dispatch.state
  into prepared_dispatch_id, prepared_dispatch_state
  from public.whatsapp_outbound_dispatches as dispatch
  where dispatch.source_ai_message_run_id = p_ai_message_run_id
    and dispatch.organization_id = p_organization_id;

  if not found then
    raise exception 'AI reply WhatsApp dispatch preparation failed'
      using errcode = 'P0001';
  end if;

  return query
    select prepared_dispatch_id, prepared_dispatch_state;
end;
$$;

revoke all
on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute
on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid)
to service_role;

comment on column public.whatsapp_outbound_dispatches.source_ai_message_run_id is
  'Optional immutable source binding; one terminal AI reply decision can prepare at most one WhatsApp outbound dispatch.';

comment on function public.prepare_ai_reply_whatsapp_dispatch(uuid, uuid) is
  'Validates and idempotently binds one stored terminal AI reply decision to one WhatsApp outbound dispatch without sending it.';
