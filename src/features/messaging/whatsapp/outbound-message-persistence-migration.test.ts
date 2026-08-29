import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baseMigrationUrl = new URL(
  "../../../../supabase/migrations/20260820114032_whatsapp_conversation_persistence.sql",
  import.meta.url,
);
const outboundMigrationUrl = new URL(
  "../../../../supabase/migrations/20260822163632_whatsapp_outbound_message_persistence.sql",
  import.meta.url,
);

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();
const baseSql = normalizeSql(await readFile(baseMigrationUrl, "utf8"));
const sql = normalizeSql(await readFile(outboundMigrationUrl, "utf8"));

test("preserves inbound inserts with received delivery semantics", () => {
  assert.match(baseSql, /'whatsapp', 'inbound', p_provider_message_id/);
  assert.match(sql, /add column delivery_status text not null default 'received'/);
  assert.match(
    sql,
    /direction = 'inbound' and delivery_status = 'received'/,
  );
  assert.match(
    sql,
    /direction = 'inbound' and sender_external_id is not null and sender_external_id ~ '\^\[0-9\]\{1,32\}\$'/,
  );
  assert.match(
    sql,
    /direction = 'inbound' and provider_timestamp is not null/,
  );
});

test("supports outbound direction and its bounded delivery lifecycle", () => {
  assert.match(sql, /check \(direction in \('inbound', 'outbound'\)\)/);
  assert.match(
    sql,
    /direction = 'outbound'.+delivery_status in \( 'accepted', 'sent', 'delivered', 'read', 'failed' \)/,
  );
  assert.match(
    sql,
    /direction = 'outbound'.+sender_external_id is null.+sender_external_id ~ '\^\[0-9\]\{1,32\}\$'/,
  );
  assert.match(
    sql,
    /alter column provider_timestamp drop not null.+direction = 'inbound' and provider_timestamp is not null.+or direction = 'outbound'/,
  );
});

test("stores outbound text messages as accepted without sender or provider timestamp", () => {
  assert.match(
    sql,
    /insert into public\.messages \(.+delivery_status \) values \( p_organization_id, p_conversation_id, 'whatsapp', 'outbound', p_provider_message_id, null, 'text', p_text_content, null, 'accepted' \)/,
  );
  assert.match(
    sql,
    /update public\.conversations as conversation set last_message_at = case when conversation\.last_message_at is null or outbound_message_at > conversation\.last_message_at then outbound_message_at else conversation\.last_message_at end/,
  );
});

test("rejects wrong tenant, conversation, or connection identity", () => {
  assert.match(sql, /conversation\.id = p_conversation_id/);
  assert.match(sql, /conversation\.organization_id = p_organization_id/);
  assert.match(
    sql,
    /conversation\.channel_connection_id = p_connection_id/,
  );
  assert.match(sql, /connection\.organization_id = p_organization_id/);
  assert.match(
    sql,
    /raise exception 'whatsapp outbound conversation is unavailable'/,
  );
});

test("rejects suspended and disconnected WhatsApp connections", () => {
  assert.match(
    sql,
    /connection\.organization_id = p_organization_id and connection\.status = 'active'/,
  );
  assert.match(
    sql,
    /connection\.status = 'active'; if not found then raise exception 'whatsapp outbound conversation is unavailable'/,
  );
});

test("makes provider message persistence idempotent and rejects conflicts", () => {
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(/);
  assert.match(sql, /message\.provider_message_id = p_provider_message_id/);
  assert.match(
    sql,
    /existing_organization_id <> p_organization_id.+existing_conversation_id <> p_conversation_id.+existing_connection_id <> p_connection_id.+existing_direction <> 'outbound'.+existing_message_type <> 'text'.+existing_text_content is distinct from p_text_content/,
  );
  assert.match(
    sql,
    /raise exception 'whatsapp provider message identity conflict'/,
  );
  assert.match(sql, /select 'duplicate'::text, existing_message_id/);
});

test("outbound storage RPC is executable only by service_role", () => {
  const signature =
    "public.store_whatsapp_outbound_message( uuid, uuid, uuid, text, text )";

  assert.ok(
    sql.includes(`revoke all on function ${signature} from public, anon, authenticated`),
  );
  assert.ok(
    sql.includes(`grant execute on function ${signature} to service_role`),
  );
  assert.match(sql, /security invoker set search_path = ''/);
});
