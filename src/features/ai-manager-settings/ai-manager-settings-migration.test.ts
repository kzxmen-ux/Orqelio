import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/20260811105332_ai_manager_settings_foundation.sql", import.meta.url),
  "utf8",
);
const timestampFixSql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260826105840_fix_ai_manager_settings_timestamp_collision.sql",
    import.meta.url,
  ),
  "utf8",
);
const serviceRoleReadGrantSql = readFileSync(
  new URL(
    "../../../supabase/migrations/20260826112638_grant_ai_manager_configuration_read_to_service_role.sql",
    import.meta.url,
  ),
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

test("timestamp fix safely replaces save and restore without changing authorization", () => {
  const replacedFunctions = [
    ...timestampFixSql.matchAll(
      /create\s+or\s+replace\s+function\s+private\.(save_ai_manager_configuration_internal|restore_ai_manager_configuration_internal)\s*\(/gi,
    ),
  ].map((match) => match[1]?.toLowerCase());

  assert.deepEqual(replacedFunctions, [
    "save_ai_manager_configuration_internal",
    "restore_ai_manager_configuration_internal",
  ]);
  assert.equal(
    (
      timestampFixSql.match(
        /operation_timestamp\s+timestamptz\s*:=\s*clock_timestamp\(\)/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(timestampFixSql, /\bcurrent_time\b/i);

  assert.match(
    timestampFixSql,
    /created_at,\s*updated_at\s*\)\s*values\s*\([\s\S]*?caller_id,\s*operation_timestamp,\s*operation_timestamp\s*\)/i,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /insert into public\.ai_manager_configuration_versions\s*\([\s\S]*?caller_id,\s*operation_timestamp\s*\)/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    timestampFixSql,
    /updated_at\s*=\s*operation_timestamp\s+where organization_id = target_organization_id/i,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /return query select next_version, next_status, true, operation_timestamp/gi,
      ) ?? []
    ).length,
    2,
  );

  assert.equal(
    (
      timestampFixSql.match(
        /language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s*=\s*''/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (timestampFixSql.match(/caller_id uuid := \(select auth\.uid\(\)\)/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /private\.is_organization_member\(target_organization_id\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (timestampFixSql.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /private\.ai_manager_configuration_is_ready\(/g,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /insert into public\.ai_manager_configuration_versions/g,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    timestampFixSql,
    /return query select\s+current_configuration\.version,[\s\S]*?false,[\s\S]*?current_configuration\.updated_at/i,
  );
  assert.match(timestampFixSql, /using errcode = '40001'/);
  assert.match(timestampFixSql, /using errcode = 'P0001'/);

  assert.equal(
    (
      timestampFixSql.match(
        /revoke all on function private\.(?:save|restore)_ai_manager_configuration_internal\([\s\S]*?\)\s*from public, anon, service_role;/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (
      timestampFixSql.match(
        /grant execute on function private\.(?:save|restore)_ai_manager_configuration_internal\([\s\S]*?\)\s*to authenticated;/gi,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(timestampFixSql, /grant execute[\s\S]*?to service_role/i);
});

test("AI runtime service role receives only current configuration read access", () => {
  const normalizedSql = serviceRoleReadGrantSql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  assert.equal(
    normalizedSql,
    "grant select on public.ai_manager_configurations to service_role;",
  );
  assert.doesNotMatch(
    serviceRoleReadGrantSql,
    /grant\s+(?:insert|update|delete|truncate|references|trigger)\b/i,
  );
  assert.doesNotMatch(serviceRoleReadGrantSql, /\bto\s+anon\b/i);
  assert.doesNotMatch(serviceRoleReadGrantSql, /disable\s+row\s+level\s+security/i);
  assert.doesNotMatch(
    serviceRoleReadGrantSql,
    /public\.ai_manager_configuration_versions/i,
  );
});
