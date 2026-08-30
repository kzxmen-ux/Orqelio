import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadBookingActionSourceCore } from "./booking-action-source-repository-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const bookingRequest = {
  serviceQuery: "стрижка",
  staffQuery: null,
  dateText: "завтра",
  timeText: "15:00",
  customerName: "Айдана",
  customerPhone: "+7 000 000 00 00",
  appointmentReference: null,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    organization_id: ORGANIZATION_ID,
    conversation_id: CONVERSATION_ID,
    status: "decided",
    decision: {
      action: "booking_action_required",
      bookingIntent: "create_appointment",
      bookingRequest,
    },
    ...overrides,
  };
}

test("durable booking source enforces tenant and run binding and exposes only safe fields", async () => {
  const calls: unknown[] = [];
  const result = await loadBookingActionSourceCore(
    ORGANIZATION_ID,
    RUN_ID,
    {
      loadRows: async (organizationId, aiMessageRunId) => {
        calls.push({ organizationId, aiMessageRunId });
        return [row()];
      },
    },
  );

  assert.deepEqual(calls, [{ organizationId: ORGANIZATION_ID, aiMessageRunId: RUN_ID }]);
  assert.deepEqual(result, {
    success: true,
    source: {
      conversationId: CONVERSATION_ID,
      bookingIntent: "create_appointment",
      bookingRequest,
    },
  });
  if (result.success) {
    assert.deepEqual(Object.keys(result.source).sort(), [
      "bookingIntent",
      "bookingRequest",
      "conversationId",
    ]);
  }
});

test("durable booking source rejects wrong tenant, non-terminal, and non-booking rows", async () => {
  for (const invalidRow of [
    row({ organization_id: "44444444-4444-4444-8444-444444444444" }),
    row({ id: "55555555-5555-4555-8555-555555555555" }),
    row({ status: "processing" }),
    row({ decision: { action: "reply", text: "hello" } }),
  ]) {
    assert.deepEqual(
      await loadBookingActionSourceCore(ORGANIZATION_ID, RUN_ID, {
        loadRows: async () => [invalidRow],
      }),
      { success: false, code: "booking_source_unavailable" },
    );
  }
});

test("durable booking source rejects malformed, extra, and duplicate data safely", async () => {
  for (const rows of [
    [],
    [row(), row()],
    [row({ decision: { ...row().decision, extra: true } })],
    [row({ decision: { action: "booking_action_required", bookingIntent: "create_appointment" } })],
  ]) {
    assert.deepEqual(
      await loadBookingActionSourceCore(ORGANIZATION_ID, RUN_ID, {
        loadRows: async () => rows,
      }),
      { success: false, code: "booking_source_unavailable" },
    );
  }
});

test("invalid identifiers and query exceptions expose one generic source failure", async () => {
  let calls = 0;
  assert.deepEqual(
    await loadBookingActionSourceCore("invalid", RUN_ID, {
      loadRows: async () => {
        calls += 1;
        return [row()];
      },
    }),
    { success: false, code: "booking_source_unavailable" },
  );
  assert.equal(calls, 0);

  const result = await loadBookingActionSourceCore(ORGANIZATION_ID, RUN_ID, {
    loadRows: async () => {
      throw new Error("raw database details");
    },
  });
  assert.deepEqual(result, { success: false, code: "booking_source_unavailable" });
  assert.doesNotMatch(JSON.stringify(result), /database details/i);
});

test("production source repository is server-only, privileged, and narrowly selected", () => {
  const source = readFileSync(
    new URL("./booking-action-source-repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /^import "server-only";/);
  assert.match(source, /createPrivilegedClient/);
  assert.match(source, /\.from\("ai_message_runs"\)/);
  assert.match(source, /id, organization_id, conversation_id, status, decision/);
  assert.doesNotMatch(source, /credential|provider_id|access_token/i);
});
