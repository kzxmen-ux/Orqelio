import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../../../supabase/migrations/20260820103738_whatsapp_webhook_inbox.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

test("WhatsApp inbox is private and has a unique payload hash", () => {
  assert.match(
    migration,
    /create table webhook_private\.whatsapp_webhook_inbox/i,
  );
  assert.match(
    migration,
    /alter table webhook_private\.whatsapp_webhook_inbox enable row level security/i,
  );
  assert.match(
    migration,
    /alter table webhook_private\.whatsapp_webhook_inbox force row level security/i,
  );
  assert.match(
    migration,
    /revoke all\s+on webhook_private\.whatsapp_webhook_inbox\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /constraint whatsapp_webhook_inbox_payload_hash_unique\s+unique \(payload_hash\)/i,
  );
});

test("public WhatsApp storage RPC is executable only by service_role", () => {
  assert.match(
    migration,
    /create function public\.store_whatsapp_webhook_event\(p_payload jsonb\)/i,
  );
  assert.match(
    migration,
    /revoke all\s+on function public\.store_whatsapp_webhook_event\(jsonb\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute\s+on function public\.store_whatsapp_webhook_event\(jsonb\)\s+to service_role/i,
  );
});
