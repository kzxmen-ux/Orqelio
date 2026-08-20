import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../../../supabase/migrations/20260820110554_whatsapp_connection_mapping.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

test("creates the organization-owned WhatsApp connection table", () => {
  assert.match(
    migration,
    /create table public\.whatsapp_channel_connections/i,
  );
  assert.match(
    migration,
    /organization_id uuid not null\s+references public\.organizations \(id\) on delete cascade/i,
  );
});

test("limits statuses and uniquely protects routing identifiers", () => {
  assert.match(
    migration,
    /check \(status in \('active', 'suspended', 'disconnected'\)\)/i,
  );
  assert.match(migration, /unique \(phone_number_id\)/i);
  assert.match(migration, /unique \(waba_id, phone_number_id\)/i);
});

test("enables RLS and revokes direct browser access", () => {
  assert.match(
    migration,
    /alter table public\.whatsapp_channel_connections enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all\s+on public\.whatsapp_channel_connections\s+from public, anon, authenticated/i,
  );
});
