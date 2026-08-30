import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  claimBookingMutationExecutionWithRpc,
  prepareBookingMutationExecutionWithRpc,
  quarantineStaleBookingMutationExecutionsWithRpc,
  recordBookingMutationFailureWithRpc,
  recordBookingMutationSuccessWithRpc,
  type BookingMutationExecutionRpc,
} from "./booking-mutation-execution-repository-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";
const trustedRequest = {
  intent: "create_appointment" as const,
  serviceId: "service-1",
  staffId: "staff-1",
  startAt: "2026-08-31T09:00:00.000Z",
  customer: { name: "Айдана", phone: "77001234567" },
};
const success = {
  success: true as const,
  data: {
    id: "provider-appointment-42",
    serviceId: "service-1",
    staffId: "staff-1",
    startAt: "2026-08-31T09:00:00.000Z",
    endAt: "2026-08-31T10:00:00.000Z",
    status: "confirmed" as const,
  },
};

function rpcReturning(data: unknown): BookingMutationExecutionRpc {
  return async () => ({ data, error: null });
}

test("preparation passes one immutable trusted request and normalizes the journal state", async () => {
  const calls: unknown[] = [];
  const result = await prepareBookingMutationExecutionWithRpc(
    { organizationId: ORGANIZATION_ID, aiMessageRunId: RUN_ID, trustedRequest },
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [{ execution_id: EXECUTION_ID, execution_state: "prepared", terminal_result: null }],
        error: null,
      };
    },
  );

  assert.deepEqual(result, { executionId: EXECUTION_ID, state: "prepared", result: null });
  assert.deepEqual(calls, [{
    functionName: "prepare_booking_mutation_execution",
    parameters: {
      p_organization_id: ORGANIZATION_ID,
      p_ai_message_run_id: RUN_ID,
      p_trusted_request: trustedRequest,
    },
  }]);
});

test("claim exposes the trusted request only to the one claimed executor", async () => {
  assert.deepEqual(
    await claimBookingMutationExecutionWithRpc(
      ORGANIZATION_ID,
      RUN_ID,
      rpcReturning([{
        outcome: "claimed",
        execution_id: EXECUTION_ID,
        trusted_request: trustedRequest,
        terminal_result: null,
      }]),
    ),
    { outcome: "claimed", executionId: EXECUTION_ID, trustedRequest },
  );

  assert.deepEqual(
    await claimBookingMutationExecutionWithRpc(
      ORGANIZATION_ID,
      RUN_ID,
      rpcReturning([{
        outcome: "already_executing",
        execution_id: EXECUTION_ID,
        trusted_request: null,
        terminal_result: null,
      }]),
    ),
    { outcome: "already_executing", executionId: EXECUTION_ID },
  );
});

test("verified success and provider appointment ID survive repository persistence", async () => {
  const result = await recordBookingMutationSuccessWithRpc(
    { organizationId: ORGANIZATION_ID, executionId: EXECUTION_ID },
    success,
    rpcReturning([{
      execution_id: EXECUTION_ID,
      execution_state: "succeeded",
      terminal_result: success,
    }]),
  );
  assert.deepEqual(result, { executionId: EXECUTION_ID, state: "succeeded", result: success });
  assert.equal(result.result.success && result.result.data.id, "provider-appointment-42");
});

test("only definitive failures can be stored as failed", async () => {
  const definitive = { success: false as const, code: "slot_unavailable" as const, retryable: false };
  assert.deepEqual(
    await recordBookingMutationFailureWithRpc(
      { organizationId: ORGANIZATION_ID, executionId: EXECUTION_ID },
      definitive,
      rpcReturning([{
        execution_id: EXECUTION_ID,
        execution_state: "failed",
        terminal_result: definitive,
      }]),
    ),
    { executionId: EXECUTION_ID, state: "failed", result: definitive },
  );

  let calls = 0;
  assert.throws(() => recordBookingMutationFailureWithRpc(
      { organizationId: ORGANIZATION_ID, executionId: EXECUTION_ID },
      { success: false, code: "provider_error", retryable: false },
      async () => {
        calls += 1;
        return { data: null, error: null };
      },
    ),
  );
  assert.equal(calls, 0);
});

test("malformed RPC results and raw RPC failures are rejected generically", async () => {
  for (const rpc of [
    rpcReturning([{ outcome: "claimed", execution_id: EXECUTION_ID, trusted_request: { ...trustedRequest, extra: true }, terminal_result: null }]),
    async () => ({ data: null, error: { message: "secret database error" } }),
    async () => { throw new Error("secret database error"); },
  ] satisfies BookingMutationExecutionRpc[]) {
    await assert.rejects(
      () => claimBookingMutationExecutionWithRpc(ORGANIZATION_ID, RUN_ID, rpc),
      /Booking mutation execution repository operation failed/,
    );
  }
});

test("stale quarantine is bounded and returns only a count", async () => {
  const calls: unknown[] = [];
  assert.deepEqual(
    await quarantineStaleBookingMutationExecutionsWithRpc(999, async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: [{ quarantined_count: 7 }], error: null };
    }),
    { quarantinedCount: 7 },
  );
  assert.deepEqual(calls, [{
    name: "quarantine_stale_booking_mutation_executions",
    parameters: { p_limit: 50 },
  }]);
});

test("Stage 5A migration enforces one journal, phone binding, terminal states, and service-role-only RPCs", () => {
  const sql = readFileSync(
    new URL("../../../supabase/migrations/20260830154547_stage_5a_safe_durable_booking_execution.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /create table public\.booking_mutation_executions/);
  assert.match(sql, /unique \(source_ai_message_run_id\)/);
  assert.match(sql, /state in \([\s\S]*'prepared'[\s\S]*'executing'[\s\S]*'succeeded'[\s\S]*'failed'[\s\S]*'indeterminate'/);
  assert.match(sql, /trusted_request jsonb not null/);
  assert.match(sql, /p_trusted_request -> 'customer' ->> 'phone'[\s\S]*= conversation\.external_participant_id/);
  assert.match(sql, /alter table public\.booking_mutation_executions enable row level security/);
  assert.match(sql, /alter table public\.booking_mutation_executions force row level security/);
  assert.match(sql, /from public, anon, authenticated, service_role/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  const quarantineSql = sql.slice(
    sql.indexOf("create function public.quarantine_stale_booking_mutation_executions"),
  );
  assert.match(quarantineSql, /where execution\.state = 'executing'[\s\S]*state = 'indeterminate'/);
  assert.doesNotMatch(quarantineSql, /state = 'prepared'/);
});
