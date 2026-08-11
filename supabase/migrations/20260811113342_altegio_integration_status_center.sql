create function private.list_altegio_integration_attempts_internal(
  target_organization_id uuid,
  target_limit integer
)
returns table (
  attempt_id uuid,
  actor_user_id uuid,
  connection_id uuid,
  attempt_status text,
  selected_location_count integer,
  activated_location_count integer,
  verified_location_count integer,
  activation_failed_count integer,
  verification_failed_count integer,
  safe_error_code text,
  callback_received_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.is_organization_member(target_organization_id) then
    raise exception 'organization membership required'
      using errcode = '42501';
  end if;

  if target_limit is null or target_limit not between 1 and 20 then
    raise exception 'invalid attempt limit' using errcode = '22023';
  end if;

  return query
  select
    attempt.id,
    attempt.user_id,
    attempt.connection_id,
    attempt.status,
    coalesce(cardinality(attempt.selected_location_ids), 0),
    coalesce(location_summary.activated_count, 0)::integer,
    coalesce(location_summary.verified_count, 0)::integer,
    coalesce(location_summary.activation_failed_count, 0)::integer,
    coalesce(location_summary.verification_failed_count, 0)::integer,
    location_summary.safe_error_code,
    attempt.callback_received_at,
    attempt.expires_at,
    attempt.completed_at,
    attempt.created_at,
    attempt.updated_at
  from private.altegio_marketplace_connection_attempts as attempt
  left join lateral (
    select
      count(*) filter (
        where location.activation_completed_at is not null
      ) as activated_count,
      count(*) filter (
        where location.status = 'verified'
      ) as verified_count,
      count(*) filter (
        where location.status = 'failed'
          and location.last_stage = 'activation'
      ) as activation_failed_count,
      count(*) filter (
        where location.status = 'failed'
          and location.last_stage = 'verification'
      ) as verification_failed_count,
      max(location.error_code) filter (
        where location.status = 'failed'
      ) as safe_error_code
    from private.altegio_marketplace_activation_locations as location
    where location.attempt_id = attempt.id
  ) as location_summary on true
  where attempt.organization_id = target_organization_id
  order by attempt.created_at desc, attempt.id desc
  limit target_limit;
end;
$$;

revoke all on function private.list_altegio_integration_attempts_internal(
  uuid,
  integer
)
from public, anon, service_role;

grant execute on function private.list_altegio_integration_attempts_internal(
  uuid,
  integer
)
to authenticated;

create function public.list_altegio_integration_attempts(
  p_organization_id uuid,
  p_limit integer
)
returns table (
  attempt_id uuid,
  actor_user_id uuid,
  connection_id uuid,
  attempt_status text,
  selected_location_count integer,
  activated_location_count integer,
  verified_location_count integer,
  activation_failed_count integer,
  verification_failed_count integer,
  safe_error_code text,
  callback_received_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.list_altegio_integration_attempts_internal(
    p_organization_id,
    p_limit
  );
$$;

revoke all on function public.list_altegio_integration_attempts(uuid, integer)
from public, anon, service_role;

grant execute on function public.list_altegio_integration_attempts(uuid, integer)
to authenticated;

comment on function private.list_altegio_integration_attempts_internal(
  uuid,
  integer
) is
  'Read-only organization-member status projection. Returns counts and bounded safe error codes only; state hashes, location identifiers, credentials, payloads, and provider responses are intentionally excluded.';
