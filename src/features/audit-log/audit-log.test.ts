import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUDIT_CATEGORY_EVENT_TYPES,
  AUDIT_EVENT_TYPES,
  getAuditCategory,
} from "./types.ts";

const sql = readFileSync(
  new URL("../../../supabase/migrations/20260811111435_organization_audit_log.sql", import.meta.url),
  "utf8",
);
const querySource = readFileSync(
  new URL("./queries/audit-events.ts", import.meta.url),
  "utf8",
);

test("audit event names are explicit and grouped into the supported filters", () => {
  assert.equal(AUDIT_EVENT_TYPES.length, 13);
  assert.deepEqual(
    [...AUDIT_CATEGORY_EVENT_TYPES.ai, ...AUDIT_CATEGORY_EVENT_TYPES.administrators, ...AUDIT_CATEGORY_EVENT_TYPES.integrations].toSorted(),
    [...AUDIT_EVENT_TYPES].toSorted(),
  );
  assert.equal(getAuditCategory("ai_settings_updated"), "ai");
  assert.equal(getAuditCategory("admin_removed"), "administrators");
  assert.equal(getAuditCategory("altegio_activation_failed"), "integrations");
});

test("owner and admin reads are tenant-isolated while browser mutations are blocked", () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /for select\s+to authenticated\s+using \(private\.is_organization_member\(organization_id\)\)/);
  assert.match(sql, /grant select on public\.organization_audit_events to authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete).*organization_audit_events/i);
  assert.doesNotMatch(sql, /\nfor (insert|update|delete)\n/i);
});

test("only the private controlled writer can append valid safe metadata", () => {
  assert.match(sql, /private\.append_organization_audit_event/);
  assert.match(sql, /revoke all on function private\.append_organization_audit_event[\s\S]*?from public, anon, authenticated, service_role/);
  for (const forbidden of ["token", "secret", "password", "cookie", "authorization", "credential", "payload", "email"]) {
    assert.match(sql, new RegExp(forbidden));
  }
  assert.match(sql, /octet_length\(target_metadata::text\) <= 4096/);
});

test("real AI, administrator, and Altegio state changes append audit events atomically", () => {
  for (const eventType of AUDIT_EVENT_TYPES) {
    assert.match(sql, new RegExp(`'${eventType}'`));
  }
  assert.match(sql, /after insert or update on public\.ai_manager_configurations/);
  assert.match(sql, /after insert or update on public\.organization_invitations/);
  assert.match(sql, /after delete on public\.organization_members/);
  assert.match(sql, /after insert or update on private\.altegio_marketplace_connection_attempts/);
  assert.match(sql, /after update on private\.altegio_marketplace_activation_locations/);
  assert.match(sql, /after update on public\.crm_connections/);
});

test("AI restore is distinguished and history is queried newest first", () => {
  assert.match(sql, /orqelio\.ai_settings_audit_operation'[\s\S]*?'ai_settings_restored'/);
  assert.match(querySource, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(querySource, /\.order\("id", \{ ascending: false \}\)/);
});

test("audit metadata contains only small non-secret operation facts", () => {
  const allowed = [
    "error_code",
    "invitation_role",
    "location_count",
    "new_status",
    "previous_status",
    "provider",
    "removed_role",
    "version_number",
  ];
  for (const key of allowed) {
    assert.match(sql, new RegExp(`'${key}'\\s*,`));
  }
  for (const forbidden of ["token", "secret", "password", "cookie", "authorization", "credential", "payload", "email", "response_body"]) {
    assert.doesNotMatch(sql, new RegExp(`'${forbidden}'\\s*,`, "i"));
  }
});
