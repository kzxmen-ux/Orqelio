import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../../../supabase/migrations/20260820114953_whatsapp_inbox_lifecycle.sql",
  import.meta.url,
);

const sql = (await readFile(migrationUrl, "utf8"))
  .replace(/\s+/g, " ")
  .toLowerCase();

const publicRpcSignatures = [
  "public.claim_whatsapp_webhook_event(uuid)",
  "public.complete_whatsapp_webhook_event(uuid)",
  "public.fail_whatsapp_webhook_event(uuid, text)",
] as const;

test("migration defines all three public lifecycle RPCs", () => {
  assert.match(sql, /create function public\.claim_whatsapp_webhook_event\s*\(/);
  assert.match(
    sql,
    /create function public\.complete_whatsapp_webhook_event\s*\(/,
  );
  assert.match(sql, /create function public\.fail_whatsapp_webhook_event\s*\(/);
});

test("migration limits lifecycle transitions to the required source states", () => {
  assert.match(
    sql,
    /set processing_status = 'processing'.+processing_status = 'pending'/,
  );
  assert.match(
    sql,
    /set processing_status = 'processed'.+processed_at = clock_timestamp\(\).+processing_status = 'processing'/,
  );
  assert.match(
    sql,
    /set processing_status = 'failed'.+processed_at = clock_timestamp\(\).+processing_status = 'processing'/,
  );
  assert.match(sql, /raise exception 'webhook event is not processing'/);
});

test("migration revokes browser access and grants only service_role execution", () => {
  for (const signature of publicRpcSignatures) {
    assert.ok(
      sql.includes(
        `revoke all on function ${signature} from public, anon, authenticated`,
      ),
    );
    assert.ok(
      sql.includes(`grant execute on function ${signature} to service_role`),
    );
  }
});

test("migration bounds stored failure codes", () => {
  assert.match(sql, /char_length\(target_error_code\) not between 1 and 64/);
  assert.match(sql, /target_error_code !~ '\^\[a-z0-9\]/);
  assert.match(sql, /error_code = target_error_code/);
});
