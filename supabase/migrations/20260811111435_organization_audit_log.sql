create type public.organization_audit_event_type as enum (
  'ai_settings_updated',
  'ai_settings_restored',
  'ai_settings_ready',
  'ai_settings_draft',
  'admin_invited',
  'admin_invitation_accepted',
  'admin_removed',
  'altegio_connection_started',
  'altegio_callback_received',
  'altegio_activation_succeeded',
  'altegio_activation_failed',
  'altegio_access_verification_failed',
  'altegio_disconnected'
);

create type public.organization_audit_target_type as enum (
  'ai_manager_configuration',
  'organization_admin',
  'organization_invitation',
  'crm_connection',
  'altegio_marketplace_attempt'
);

create function private.organization_audit_metadata_is_safe(
  target_metadata jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    target_metadata is not null
    and pg_catalog.jsonb_typeof(target_metadata) = 'object'
    and pg_catalog.octet_length(target_metadata::text) <= 4096
    and target_metadata::text !~* (
      '"[^"\\]*(token|secret|password|cookie|authorization|credential|'
      || 'payload|provider_response|response_body|request_body|headers?|email)'
      || '[^"\\]*"[[:space:]]*:'
    );
$$;

create table public.organization_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type public.organization_audit_event_type not null,
  target_type public.organization_audit_target_type,
  target_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint organization_audit_events_metadata_safe
    check (private.organization_audit_metadata_is_safe(safe_metadata)),
  constraint organization_audit_events_target_consistent
    check ((target_type is null) = (target_id is null))
);

create index organization_audit_events_organization_created_idx
  on public.organization_audit_events (organization_id, created_at desc, id desc);

create index organization_audit_events_actor_user_idx
  on public.organization_audit_events (actor_user_id)
  where actor_user_id is not null;

alter table public.organization_audit_events enable row level security;
alter table public.organization_audit_events force row level security;

create policy "organization members can read organization audit events"
on public.organization_audit_events
for select
to authenticated
using (private.is_organization_member(organization_id));

revoke all on public.organization_audit_events
from public, anon, authenticated, service_role;
grant select on public.organization_audit_events to authenticated;

create function private.append_organization_audit_event(
  target_organization_id uuid,
  target_actor_user_id uuid,
  target_event_type public.organization_audit_event_type,
  target_target_type public.organization_audit_target_type,
  target_target_id uuid,
  target_safe_metadata jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_event_id bigint;
begin
  if target_organization_id is null
    or target_event_type is null
    or not private.organization_audit_metadata_is_safe(target_safe_metadata)
  then
    raise exception 'invalid audit event' using errcode = '22023';
  end if;

  insert into public.organization_audit_events (
    organization_id,
    actor_user_id,
    event_type,
    target_type,
    target_id,
    safe_metadata
  ) values (
    target_organization_id,
    target_actor_user_id,
    target_event_type,
    target_target_type,
    target_target_id,
    target_safe_metadata
  )
  returning id into created_event_id;

  return created_event_id;
end;
$$;

revoke all on function private.organization_audit_metadata_is_safe(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.append_organization_audit_event(
  uuid, uuid, public.organization_audit_event_type,
  public.organization_audit_target_type, uuid, jsonb
)
from public, anon, authenticated, service_role;

create function private.audit_ai_manager_configuration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation_type public.organization_audit_event_type;
begin
  operation_type := case
    when pg_catalog.current_setting(
      'orqelio.ai_settings_audit_operation',
      true
    ) = 'ai_settings_restored'
      then 'ai_settings_restored'::public.organization_audit_event_type
    else 'ai_settings_updated'::public.organization_audit_event_type
  end;

  perform private.append_organization_audit_event(
    new.organization_id,
    (select auth.uid()),
    operation_type,
    'ai_manager_configuration'::public.organization_audit_target_type,
    new.organization_id,
    jsonb_build_object(
      'version_number', new.version,
      'previous_status', case when tg_op = 'UPDATE' then old.status::text else null end,
      'new_status', new.status::text
    )
  );

  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform private.append_organization_audit_event(
      new.organization_id,
      (select auth.uid()),
      case
        when new.status = 'ready'::public.ai_manager_configuration_status
          then 'ai_settings_ready'::public.organization_audit_event_type
        else 'ai_settings_draft'::public.organization_audit_event_type
      end,
      'ai_manager_configuration'::public.organization_audit_target_type,
      new.organization_id,
      jsonb_build_object(
        'version_number', new.version,
        'previous_status', case when tg_op = 'UPDATE' then old.status::text else null end,
        'new_status', new.status::text
      )
    );
  end if;

  return new;
end;
$$;

create trigger ai_manager_configuration_audit
after insert or update on public.ai_manager_configurations
for each row execute function private.audit_ai_manager_configuration_change();

create or replace function public.save_ai_manager_configuration(
  p_organization_id uuid,
  p_expected_version integer,
  p_primary_language public.ai_manager_primary_language,
  p_formality public.ai_manager_formality,
  p_communication_style public.ai_manager_communication_style,
  p_raw_business_context text,
  p_handoff_client_requests_admin boolean,
  p_handoff_ai_uncertain boolean,
  p_handoff_booking_error boolean,
  p_handoff_customer_complaint boolean,
  p_handoff_medical_question boolean,
  p_handoff_payment_dispute boolean,
  p_handoff_other_cases text
)
returns table (
  saved_version integer,
  saved_status public.ai_manager_configuration_status,
  changed boolean,
  saved_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'orqelio.ai_settings_audit_operation',
    'ai_settings_updated',
    true
  );

  return query
  select * from private.save_ai_manager_configuration_internal(
    p_organization_id,
    p_expected_version,
    p_primary_language,
    p_formality,
    p_communication_style,
    p_raw_business_context,
    p_handoff_client_requests_admin,
    p_handoff_ai_uncertain,
    p_handoff_booking_error,
    p_handoff_customer_complaint,
    p_handoff_medical_question,
    p_handoff_payment_dispute,
    p_handoff_other_cases
  );
end;
$$;

create or replace function public.restore_ai_manager_configuration(
  p_organization_id uuid,
  p_version integer,
  p_expected_version integer
)
returns table (
  saved_version integer,
  saved_status public.ai_manager_configuration_status,
  changed boolean,
  saved_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'orqelio.ai_settings_audit_operation',
    'ai_settings_restored',
    true
  );

  return query
  select * from private.restore_ai_manager_configuration_internal(
    p_organization_id,
    p_version,
    p_expected_version
  );
end;
$$;

create function private.audit_organization_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.append_organization_audit_event(
      new.organization_id,
      new.invited_by,
      'admin_invited'::public.organization_audit_event_type,
      'organization_invitation'::public.organization_audit_target_type,
      new.id,
      jsonb_build_object('invitation_role', 'admin')
    );
  elsif old.accepted_at is null and new.accepted_at is not null then
    perform private.append_organization_audit_event(
      new.organization_id,
      new.accepted_by,
      'admin_invitation_accepted'::public.organization_audit_event_type,
      'organization_invitation'::public.organization_audit_target_type,
      new.id,
      jsonb_build_object('invitation_role', 'admin')
    );
  end if;

  return new;
end;
$$;

create trigger organization_invitation_audit
after insert or update on public.organization_invitations
for each row execute function private.audit_organization_invitation_change();

create function private.audit_organization_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'::public.organization_role then
    perform private.append_organization_audit_event(
      old.organization_id,
      (select auth.uid()),
      'admin_removed'::public.organization_audit_event_type,
      'organization_admin'::public.organization_audit_target_type,
      old.user_id,
      jsonb_build_object('removed_role', 'admin')
    );
  end if;

  return old;
end;
$$;

create trigger organization_admin_removal_audit
after delete on public.organization_members
for each row execute function private.audit_organization_admin_removal();

create function private.audit_altegio_marketplace_attempt_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_count integer;
begin
  if tg_op = 'INSERT' then
    perform private.append_organization_audit_event(
      new.organization_id,
      new.user_id,
      'altegio_connection_started'::public.organization_audit_event_type,
      'altegio_marketplace_attempt'::public.organization_audit_target_type,
      new.id,
      jsonb_build_object('provider', 'altegio')
    );
    return new;
  end if;

  location_count := coalesce(cardinality(new.selected_location_ids), 0);

  if old.callback_received_at is null and new.callback_received_at is not null then
    perform private.append_organization_audit_event(
      new.organization_id,
      new.user_id,
      'altegio_callback_received'::public.organization_audit_event_type,
      'altegio_marketplace_attempt'::public.organization_audit_target_type,
      new.id,
      jsonb_build_object(
        'provider', 'altegio',
        'location_count', location_count
      )
    );
  end if;

  if old.status is distinct from new.status and new.status = 'succeeded' then
    perform private.append_organization_audit_event(
      new.organization_id,
      new.user_id,
      'altegio_activation_succeeded'::public.organization_audit_event_type,
      'crm_connection'::public.organization_audit_target_type,
      new.connection_id,
      jsonb_build_object(
        'provider', 'altegio',
        'location_count', location_count
      )
    );
  end if;

  return new;
end;
$$;

create trigger altegio_marketplace_attempt_audit
after insert or update on private.altegio_marketplace_connection_attempts
for each row execute function private.audit_altegio_marketplace_attempt_change();

create function private.audit_altegio_location_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_attempt private.altegio_marketplace_connection_attempts%rowtype;
  audit_type public.organization_audit_event_type;
begin
  if new.status <> 'failed'
    or (old.status = 'failed' and old.last_stage is not distinct from new.last_stage)
  then
    return new;
  end if;

  select attempt.* into parent_attempt
  from private.altegio_marketplace_connection_attempts as attempt
  where attempt.id = new.attempt_id;

  audit_type := case
    when new.last_stage = 'verification'
      then 'altegio_access_verification_failed'::public.organization_audit_event_type
    else 'altegio_activation_failed'::public.organization_audit_event_type
  end;

  perform private.append_organization_audit_event(
    parent_attempt.organization_id,
    parent_attempt.user_id,
    audit_type,
    'altegio_marketplace_attempt'::public.organization_audit_target_type,
    parent_attempt.id,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', 'altegio',
      'location_count', 1,
      'error_code', new.error_code
    ))
  );

  return new;
end;
$$;

create trigger altegio_marketplace_location_failure_audit
after update on private.altegio_marketplace_activation_locations
for each row execute function private.audit_altegio_location_failure();

create function private.audit_altegio_disconnection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'disconnected'::public.crm_connection_status
    and new.provider = 'altegio'::public.crm_provider
  then
    perform private.append_organization_audit_event(
      new.organization_id,
      (select auth.uid()),
      'altegio_disconnected'::public.organization_audit_event_type,
      'crm_connection'::public.organization_audit_target_type,
      new.id,
      jsonb_build_object('provider', 'altegio')
    );
  end if;

  return new;
end;
$$;

create trigger altegio_connection_disconnection_audit
after update on public.crm_connections
for each row execute function private.audit_altegio_disconnection();

revoke all on function private.audit_ai_manager_configuration_change()
from public, anon, authenticated, service_role;
revoke all on function private.audit_organization_invitation_change()
from public, anon, authenticated, service_role;
revoke all on function private.audit_organization_admin_removal()
from public, anon, authenticated, service_role;
revoke all on function private.audit_altegio_marketplace_attempt_change()
from public, anon, authenticated, service_role;
revoke all on function private.audit_altegio_location_failure()
from public, anon, authenticated, service_role;
revoke all on function private.audit_altegio_disconnection()
from public, anon, authenticated, service_role;

revoke usage on type public.organization_audit_event_type,
  public.organization_audit_target_type
from public, anon, service_role;
grant usage on type public.organization_audit_event_type,
  public.organization_audit_target_type
to authenticated;

comment on table public.organization_audit_events is
  'Immutable organization-scoped administrative and integration audit trail. Not generic application logging.';
comment on column public.organization_audit_events.safe_metadata is
  'Small allowlisted operation metadata only. Secrets, credentials, raw payloads, email addresses, and provider responses are forbidden.';
comment on function private.append_organization_audit_event(
  uuid, uuid, public.organization_audit_event_type,
  public.organization_audit_target_type, uuid, jsonb
) is
  'Private trigger-only writer. SECURITY DEFINER is required because browser roles have no insert access to the append-only audit table.';
