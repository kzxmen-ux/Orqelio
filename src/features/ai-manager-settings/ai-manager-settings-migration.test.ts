import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/20260811105332_ai_manager_settings_foundation.sql", import.meta.url),
  "utf8",
);

test("AI manager settings use tenant RLS and block direct mutations", () => {
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /force row level security/g);
  assert.equal((sql.match(/private\.is_organization_member\(organization_id\)/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /\nfor (insert|update|delete)\n/i);
  assert.match(sql, /grant select on public\.ai_manager_configurations to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete).*ai_manager_configuration/i);
});

test("save is atomic, monotonic and idempotent", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /next_version := current_configuration\.version \+ 1/);
  assert.match(sql, /return query select\s+current_configuration\.version,[\s\S]*?false/);
  assert.match(sql, /insert into public\.ai_manager_configuration_versions/g);
  assert.match(sql, /expected_version <> current_configuration\.version/);
});

test("restore copies a same-organization snapshot into a new immutable version", () => {
  assert.match(sql, /historical\.organization_id = target_organization_id/);
  assert.match(sql, /historical\.version = target_version/);
  assert.match(sql, /source_version\.handoff_client_requests_admin/);
  assert.match(sql, /Immutable snapshots created only by controlled save and restore functions/);
});

test("only owner and admin memberships can reach the settings RPC", () => {
  assert.match(sql, /private\.is_organization_member\(target_organization_id\)/g);
  assert.match(sql, /caller_id uuid := \(select auth\.uid\(\)\)/g);
  assert.doesNotMatch(sql, /grant execute[\s\S]*?to service_role/i);
});
