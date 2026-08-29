import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../../../supabase/migrations/20260820114032_whatsapp_conversation_persistence.sql",
  import.meta.url,
);
const migration = readFileSync(migrationPath, "utf8");

test("creates conversations and messages with required ownership FKs", () => {
  assert.match(migration, /create table public\.conversations/i);
  assert.match(migration, /create table public\.messages/i);
  assert.match(
    migration,
    /organization_id uuid not null\s+references public\.organizations \(id\) on delete cascade/i,
  );
  assert.match(
    migration,
    /channel_connection_id uuid not null\s+references public\.whatsapp_channel_connections \(id\) on delete cascade/i,
  );
});

test("enforces conversation identity and provider message idempotency", () => {
  assert.match(
    migration,
    /unique \(\s*organization_id,\s*channel_connection_id,\s*external_participant_id\s*\)/i,
  );
  assert.match(
    migration,
    /unique \(channel, provider_message_id\)/i,
  );
});

test("enables and forces RLS without browser table access", () => {
  for (const table of ["conversations", "messages"]) {
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `alter table public\\.${table} force row level security`,
        "i",
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on public\\.${table} from public, anon, authenticated`,
        "i",
      ),
    );
  }
});

test("storage RPC is not executable by browser roles", () => {
  assert.match(
    migration,
    /revoke all\s+on function public\.store_whatsapp_inbound_message\([\s\S]+?\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute\s+on function public\.store_whatsapp_inbound_message\([\s\S]+?\)\s+to service_role/i,
  );
});

test("RPC keeps display metadata and last-message time monotonic", () => {
  assert.match(
    migration,
    /display_name = coalesce\(\s*excluded\.display_name,\s*conversations\.display_name\s*\)/i,
  );
  assert.match(
    migration,
    /excluded\.last_message_at > conversations\.last_message_at/i,
  );
});
