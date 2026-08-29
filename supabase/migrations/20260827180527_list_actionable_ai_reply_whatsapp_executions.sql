create function public.list_actionable_ai_reply_whatsapp_executions(
  p_limit integer
)
returns table (
  organization_id uuid,
  ai_message_run_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid actionable AI reply WhatsApp execution limit'
      using errcode = '22023';
  end if;

  return query
    select
      run.organization_id,
      run.id
    from public.ai_message_runs as run
    join public.conversations as conversation
      on conversation.id = run.conversation_id
    left join public.whatsapp_outbound_dispatches as dispatch
      on dispatch.source_ai_message_run_id = run.id
    left join public.whatsapp_channel_connections as connection
      on connection.id = conversation.channel_connection_id
    where run.status = 'decided'
      and jsonb_typeof(run.decision) = 'object'
      and run.decision ->> 'action' = 'reply'
      and run.decision - array['action', 'text'] = '{}'::jsonb
      and jsonb_typeof(run.decision -> 'text') = 'string'
      and char_length(run.decision ->> 'text') between 1 and 2000
      and run.decision ->> 'text' = btrim(run.decision ->> 'text')
      and conversation.organization_id = run.organization_id
      and conversation.channel = 'whatsapp'
      and (
        (
          dispatch.id is null
          and conversation.channel_connection_id is not null
          and connection.id = conversation.channel_connection_id
          and connection.organization_id = run.organization_id
          and connection.status = 'active'
        )
        or (
          dispatch.id is not null
          and dispatch.organization_id = run.organization_id
          and dispatch.conversation_id = run.conversation_id
          and dispatch.connection_id = conversation.channel_connection_id
          and connection.id = dispatch.connection_id
          and connection.organization_id = run.organization_id
          and (
            (
              dispatch.state = 'prepared'
              and connection.status = 'active'
            )
            or dispatch.state = 'provider_accepted'
          )
        )
      )
    order by run.updated_at, run.id
    limit p_limit;
end;
$$;

revoke all
on function public.list_actionable_ai_reply_whatsapp_executions(integer)
from public, anon, authenticated, service_role;

grant execute
on function public.list_actionable_ai_reply_whatsapp_executions(integer)
to service_role;

comment on function public.list_actionable_ai_reply_whatsapp_executions(integer) is
  'Lists bounded tenant-validated terminal AI reply executions that can be safely prepared, claimed, or finalized without exposing outbound payloads.';
