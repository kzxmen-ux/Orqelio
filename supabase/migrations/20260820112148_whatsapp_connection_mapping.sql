create table public.whatsapp_channel_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_channel_connections_waba_id
    check (waba_id ~ '^[0-9]{1,32}$'),
  constraint whatsapp_channel_connections_phone_number_id
    check (phone_number_id ~ '^[0-9]{1,32}$'),
  constraint whatsapp_channel_connections_status
    check (status in ('active', 'suspended', 'disconnected')),
  constraint whatsapp_channel_connections_phone_number_id_unique
    unique (phone_number_id),
  constraint whatsapp_channel_connections_waba_phone_unique
    unique (waba_id, phone_number_id)
);

create index whatsapp_channel_connections_organization_idx
  on public.whatsapp_channel_connections (organization_id);

alter table public.whatsapp_channel_connections enable row level security;
alter table public.whatsapp_channel_connections force row level security;

revoke all
on public.whatsapp_channel_connections
from public, anon, authenticated;

grant select, insert, update, delete
on public.whatsapp_channel_connections
to service_role;

create function private.set_whatsapp_channel_connection_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all
on function private.set_whatsapp_channel_connection_updated_at()
from public, anon, authenticated, service_role;

create trigger whatsapp_channel_connections_set_updated_at
before update on public.whatsapp_channel_connections
for each row
execute function private.set_whatsapp_channel_connection_updated_at();

comment on table public.whatsapp_channel_connections is
  'Server-only mapping from Meta WABA and phone number identifiers to one Orqelio organization.';

comment on column public.whatsapp_channel_connections.waba_id is
  'Opaque decimal Meta WABA identifier. It is routing metadata, never an access token.';

comment on column public.whatsapp_channel_connections.phone_number_id is
  'Opaque decimal Meta phone number identifier used for unambiguous inbound routing.';
