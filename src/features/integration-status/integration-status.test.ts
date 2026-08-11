import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { CrmConnection } from "../crm-connections/types.ts";
import { createIntegrationDiagnosticReference } from "./diagnostic-reference.ts";
import { integrationErrorLabel } from "./presentation.ts";
import { resolveAltegioStatusCenter } from "./status-center.ts";
import type { AltegioIntegrationAttempt } from "./types.ts";

const now = new Date("2026-08-11T12:00:00.000Z");

function attempt(
  overrides: Partial<AltegioIntegrationAttempt> = {},
): AltegioIntegrationAttempt {
  return {
    activatedLocationCount: 0,
    activationFailedCount: 0,
    actorUserId: "10000000-0000-4000-8000-000000000001",
    attemptId: "20000000-0000-4000-8000-000000000001",
    callbackReceivedAt: null,
    canRetry: false,
    completedAt: null,
    connectionId: null,
    createdAt: "2026-08-11T11:00:00.000Z",
    expiresAt: "2026-08-11T12:15:00.000Z",
    safeErrorCode: null,
    selectedLocationCount: 0,
    status: "pending",
    updatedAt: "2026-08-11T11:00:00.000Z",
    verificationFailedCount: 0,
    verifiedLocationCount: 0,
    ...overrides,
  };
}

function connection(
  status: CrmConnection["status"],
  configuration: CrmConnection["configuration"] = {},
): CrmConnection {
  return {
    configuration,
    createdAt: "2026-08-11T10:00:00.000Z",
    displayName: "Altegio",
    id: "30000000-0000-4000-8000-000000000001",
    lastSyncAt: null,
    organizationId: "40000000-0000-4000-8000-000000000001",
    provider: "altegio",
    status,
    updatedAt: "2026-08-11T11:30:00.000Z",
  };
}

describe("Altegio integration status center", () => {
  test("shows no connection without persisted state", () => {
    const center = resolveAltegioStatusCenter({ attempts: [], connections: [], now });
    assert.equal(center.status, "not_connected");
    assert.deepEqual(center.progress.map((step) => step.state), ["current", "pending", "pending", "pending", "pending"]);
  });

  test("shows a pending attempt waiting for Altegio", () => {
    const center = resolveAltegioStatusCenter({ attempts: [attempt()], connections: [], now });
    assert.equal(center.status, "awaiting_return");
    assert.equal(center.progress[1]?.state, "current");
  });

  test("treats an expired pending attempt as a safe error", () => {
    const center = resolveAltegioStatusCenter({
      attempts: [attempt({ expiresAt: "2026-08-11T11:59:59.000Z" })],
      connections: [],
      now,
    });
    assert.equal(center.status, "error");
    assert.equal(center.errorCategory, "expired");
  });

  test("maps a single-location success to connected", () => {
    const center = resolveAltegioStatusCenter({
      attempts: [attempt({ activatedLocationCount: 1, callbackReceivedAt: now.toISOString(), selectedLocationCount: 1, status: "succeeded", verifiedLocationCount: 1 })],
      connections: [connection("connected", { providerActivationStatus: "verified", verifiedLocationIds: ["hidden"] })],
      now,
    });
    assert.equal(center.status, "connected");
    assert.ok(center.progress.every((step) => step.state === "completed"));
  });

  test("maps multi-location partial activation without exposing location IDs", () => {
    const center = resolveAltegioStatusCenter({
      attempts: [attempt({ activatedLocationCount: 2, activationFailedCount: 1, callbackReceivedAt: now.toISOString(), selectedLocationCount: 3, status: "partial", verifiedLocationCount: 2 })],
      connections: [connection("error", { providerActivationStatus: "partial" })],
      now,
    });
    assert.equal(center.status, "partial");
    assert.equal(center.errorCategory, "partial_activation");
    assert.equal(center.latestAttempt?.activatedLocationCount, 2);
  });

  test("maps multi-location full success", () => {
    const center = resolveAltegioStatusCenter({
      attempts: [attempt({ activatedLocationCount: 3, callbackReceivedAt: now.toISOString(), selectedLocationCount: 3, status: "succeeded", verifiedLocationCount: 3 })],
      connections: [connection("connected")],
      now,
    });
    assert.equal(center.status, "connected");
  });

  test("maps provider and access verification failures to bounded categories", () => {
    const unavailable = resolveAltegioStatusCenter({ attempts: [attempt({ safeErrorCode: "timeout", status: "error" })], connections: [], now });
    const verification = resolveAltegioStatusCenter({ attempts: [attempt({ status: "error", verificationFailedCount: 1 })], connections: [], now });
    assert.equal(unavailable.errorCategory, "provider_unavailable");
    assert.equal(verification.errorCategory, "verification_failed");
  });

  test("maps a persisted disconnected connection", () => {
    const center = resolveAltegioStatusCenter({ attempts: [], connections: [connection("disconnected")], now });
    assert.equal(center.status, "disconnected");
  });
});

test("diagnostic references are stable, compact, and do not reveal UUIDs", () => {
  const id = "20000000-0000-4000-8000-000000000001";
  const reference = createIntegrationDiagnosticReference(id);
  assert.equal(reference, createIntegrationDiagnosticReference(id));
  assert.match(reference, /^INT-[A-F0-9]{6}$/);
  assert.equal(reference.includes(id.slice(0, 8)), false);
  assert.notEqual(reference, createIntegrationDiagnosticReference("20000000-0000-4000-8000-000000000002"));
});

test("provider errors are rendered only as safe localized categories", () => {
  const rawProviderError = "provider-internal-code: opaque response details";
  const label = integrationErrorLabel("unknown_provider_error", "ru");
  assert.equal(label, "Неизвестная ошибка провайдера");
  assert.equal(label.includes(rawProviderError), false);
});

test("status RPC enforces organization isolation and returns only a safe projection", () => {
  const sql = readFileSync(
    new URL("../../../supabase/migrations/20260811113342_altegio_integration_status_center.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /private\.is_organization_member\(target_organization_id\)/);
  assert.match(sql, /where attempt\.organization_id = target_organization_id/);
  assert.match(sql, /order by attempt\.created_at desc, attempt\.id desc/);
  assert.match(sql, /revoke all on function public\.list_altegio_integration_attempts\(uuid, integer\)[\s\S]*from public, anon, service_role/);
  const returnColumns = sql.match(/returns table \(([\s\S]*?)\)\n+language/)?.[1] ?? "";
  assert.doesNotMatch(returnColumns, /state_hash/);
  assert.doesNotMatch(returnColumns, /selected_location_ids/);
});
