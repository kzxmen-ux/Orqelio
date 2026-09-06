grant select (
  id,
  organization_id,
  provider,
  display_name,
  status,
  configuration,
  created_at,
  updated_at,
  last_sync_at
)
on table public.crm_connections
to service_role;
