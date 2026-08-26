create or replace function private.save_ai_manager_configuration_internal(
  target_organization_id uuid,
  expected_version integer,
  target_primary_language public.ai_manager_primary_language,
  target_formality public.ai_manager_formality,
  target_communication_style public.ai_manager_communication_style,
  target_raw_business_context text,
  target_handoff_client_requests_admin boolean,
  target_handoff_ai_uncertain boolean,
  target_handoff_booking_error boolean,
  target_handoff_customer_complaint boolean,
  target_handoff_medical_question boolean,
  target_handoff_payment_dispute boolean,
  target_handoff_other_cases text
)
returns table (
  saved_version integer,
  saved_status public.ai_manager_configuration_status,
  changed boolean,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_configuration public.ai_manager_configurations%rowtype;
  next_version integer;
  next_status public.ai_manager_configuration_status;
  operation_timestamp timestamptz := clock_timestamp();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_organization_member(target_organization_id) then
    raise exception 'organization membership required' using errcode = '42501';
  end if;

  if expected_version is null or expected_version < 0 then
    raise exception 'invalid expected version' using errcode = '22023';
  end if;

  if target_raw_business_context is null
    or char_length(target_raw_business_context) not between 1 and 30000
    or target_handoff_other_cases is null
    or char_length(target_handoff_other_cases) > 2000
  then
    raise exception 'invalid AI manager configuration' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-manager-configuration:' || target_organization_id::text,
      0
    )
  );

  select configuration.*
  into current_configuration
  from public.ai_manager_configurations as configuration
  where configuration.organization_id = target_organization_id
  for update;

  if current_configuration.organization_id is null then
    if expected_version <> 0 then
      raise exception 'AI manager configuration changed'
        using errcode = '40001';
    end if;
    next_version := 1;
  else
    if expected_version <> current_configuration.version then
      raise exception 'AI manager configuration changed'
        using errcode = '40001';
    end if;

    if current_configuration.primary_language = target_primary_language
      and current_configuration.formality = target_formality
      and current_configuration.communication_style = target_communication_style
      and current_configuration.raw_business_context = target_raw_business_context
      and current_configuration.handoff_client_requests_admin = target_handoff_client_requests_admin
      and current_configuration.handoff_ai_uncertain = target_handoff_ai_uncertain
      and current_configuration.handoff_booking_error = target_handoff_booking_error
      and current_configuration.handoff_customer_complaint = target_handoff_customer_complaint
      and current_configuration.handoff_medical_question = target_handoff_medical_question
      and current_configuration.handoff_payment_dispute = target_handoff_payment_dispute
      and current_configuration.handoff_other_cases = target_handoff_other_cases
    then
      return query select
        current_configuration.version,
        current_configuration.status,
        false,
        current_configuration.updated_at;
      return;
    end if;

    next_version := current_configuration.version + 1;
  end if;

  next_status := case
    when private.ai_manager_configuration_is_ready(
      target_raw_business_context,
      target_handoff_client_requests_admin,
      target_handoff_ai_uncertain,
      target_handoff_booking_error,
      target_handoff_customer_complaint,
      target_handoff_medical_question,
      target_handoff_payment_dispute,
      target_handoff_other_cases
    ) then 'ready'::public.ai_manager_configuration_status
    else 'draft'::public.ai_manager_configuration_status
  end;

  insert into public.ai_manager_configurations (
    organization_id,
    primary_language,
    formality,
    communication_style,
    raw_business_context,
    status,
    version,
    handoff_client_requests_admin,
    handoff_ai_uncertain,
    handoff_booking_error,
    handoff_customer_complaint,
    handoff_medical_question,
    handoff_payment_dispute,
    handoff_other_cases,
    updated_by,
    created_at,
    updated_at
  ) values (
    target_organization_id,
    target_primary_language,
    target_formality,
    target_communication_style,
    target_raw_business_context,
    next_status,
    next_version,
    target_handoff_client_requests_admin,
    target_handoff_ai_uncertain,
    target_handoff_booking_error,
    target_handoff_customer_complaint,
    target_handoff_medical_question,
    target_handoff_payment_dispute,
    target_handoff_other_cases,
    caller_id,
    operation_timestamp,
    operation_timestamp
  )
  on conflict (organization_id) do update set
    primary_language = excluded.primary_language,
    formality = excluded.formality,
    communication_style = excluded.communication_style,
    raw_business_context = excluded.raw_business_context,
    status = excluded.status,
    version = excluded.version,
    handoff_client_requests_admin = excluded.handoff_client_requests_admin,
    handoff_ai_uncertain = excluded.handoff_ai_uncertain,
    handoff_booking_error = excluded.handoff_booking_error,
    handoff_customer_complaint = excluded.handoff_customer_complaint,
    handoff_medical_question = excluded.handoff_medical_question,
    handoff_payment_dispute = excluded.handoff_payment_dispute,
    handoff_other_cases = excluded.handoff_other_cases,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.ai_manager_configuration_versions (
    organization_id,
    version,
    primary_language,
    formality,
    communication_style,
    raw_business_context,
    status,
    handoff_client_requests_admin,
    handoff_ai_uncertain,
    handoff_booking_error,
    handoff_customer_complaint,
    handoff_medical_question,
    handoff_payment_dispute,
    handoff_other_cases,
    created_by,
    created_at
  ) values (
    target_organization_id,
    next_version,
    target_primary_language,
    target_formality,
    target_communication_style,
    target_raw_business_context,
    next_status,
    target_handoff_client_requests_admin,
    target_handoff_ai_uncertain,
    target_handoff_booking_error,
    target_handoff_customer_complaint,
    target_handoff_medical_question,
    target_handoff_payment_dispute,
    target_handoff_other_cases,
    caller_id,
    operation_timestamp
  );

  return query select next_version, next_status, true, operation_timestamp;
end;
$$;

create or replace function private.restore_ai_manager_configuration_internal(
  target_organization_id uuid,
  target_version integer,
  expected_version integer
)
returns table (
  saved_version integer,
  saved_status public.ai_manager_configuration_status,
  changed boolean,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_configuration public.ai_manager_configurations%rowtype;
  source_version public.ai_manager_configuration_versions%rowtype;
  next_version integer;
  next_status public.ai_manager_configuration_status;
  operation_timestamp timestamptz := clock_timestamp();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_organization_member(target_organization_id) then
    raise exception 'organization membership required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ai-manager-configuration:' || target_organization_id::text,
      0
    )
  );

  select configuration.*
  into current_configuration
  from public.ai_manager_configurations as configuration
  where configuration.organization_id = target_organization_id
  for update;

  if current_configuration.organization_id is null
    or expected_version <> current_configuration.version
  then
    raise exception 'AI manager configuration changed'
      using errcode = '40001';
  end if;

  select historical.*
  into source_version
  from public.ai_manager_configuration_versions as historical
  where historical.organization_id = target_organization_id
    and historical.version = target_version;

  if source_version.organization_id is null then
    raise exception 'AI manager configuration version not found'
      using errcode = 'P0001';
  end if;

  next_version := current_configuration.version + 1;
  next_status := case
    when private.ai_manager_configuration_is_ready(
      source_version.raw_business_context,
      source_version.handoff_client_requests_admin,
      source_version.handoff_ai_uncertain,
      source_version.handoff_booking_error,
      source_version.handoff_customer_complaint,
      source_version.handoff_medical_question,
      source_version.handoff_payment_dispute,
      source_version.handoff_other_cases
    ) then 'ready'::public.ai_manager_configuration_status
    else 'draft'::public.ai_manager_configuration_status
  end;

  update public.ai_manager_configurations set
    primary_language = source_version.primary_language,
    formality = source_version.formality,
    communication_style = source_version.communication_style,
    raw_business_context = source_version.raw_business_context,
    status = next_status,
    version = next_version,
    handoff_client_requests_admin = source_version.handoff_client_requests_admin,
    handoff_ai_uncertain = source_version.handoff_ai_uncertain,
    handoff_booking_error = source_version.handoff_booking_error,
    handoff_customer_complaint = source_version.handoff_customer_complaint,
    handoff_medical_question = source_version.handoff_medical_question,
    handoff_payment_dispute = source_version.handoff_payment_dispute,
    handoff_other_cases = source_version.handoff_other_cases,
    updated_by = caller_id,
    updated_at = operation_timestamp
  where organization_id = target_organization_id;

  insert into public.ai_manager_configuration_versions (
    organization_id,
    version,
    primary_language,
    formality,
    communication_style,
    raw_business_context,
    status,
    handoff_client_requests_admin,
    handoff_ai_uncertain,
    handoff_booking_error,
    handoff_customer_complaint,
    handoff_medical_question,
    handoff_payment_dispute,
    handoff_other_cases,
    created_by,
    created_at
  ) values (
    target_organization_id,
    next_version,
    source_version.primary_language,
    source_version.formality,
    source_version.communication_style,
    source_version.raw_business_context,
    next_status,
    source_version.handoff_client_requests_admin,
    source_version.handoff_ai_uncertain,
    source_version.handoff_booking_error,
    source_version.handoff_customer_complaint,
    source_version.handoff_medical_question,
    source_version.handoff_payment_dispute,
    source_version.handoff_other_cases,
    caller_id,
    operation_timestamp
  );

  return query select next_version, next_status, true, operation_timestamp;
end;
$$;

revoke all on function private.save_ai_manager_configuration_internal(
  uuid, integer, public.ai_manager_primary_language,
  public.ai_manager_formality, public.ai_manager_communication_style,
  text, boolean, boolean, boolean, boolean, boolean, boolean, text
)
from public, anon, service_role;
revoke all on function private.restore_ai_manager_configuration_internal(
  uuid, integer, integer
)
from public, anon, service_role;

grant execute on function private.save_ai_manager_configuration_internal(
  uuid, integer, public.ai_manager_primary_language,
  public.ai_manager_formality, public.ai_manager_communication_style,
  text, boolean, boolean, boolean, boolean, boolean, boolean, text
)
to authenticated;
grant execute on function private.restore_ai_manager_configuration_internal(
  uuid, integer, integer
)
to authenticated;
