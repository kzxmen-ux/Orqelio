import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  executeAiBookingActionCore,
  type AiBookingActionExecutorDependencies,
} from "./ai-booking-action-executor-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const EXECUTION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-30T08:00:00.000Z";
const bookingRequest = {
  serviceQuery: "стрижка",
  staffQuery: "Алексей",
  dateText: "завтра",
  timeText: "15:00",
  customerName: "Айдана",
  customerPhone: "untrusted-model-phone",
  appointmentReference: null,
};
const trustedRequest = {
  intent: "create_appointment" as const,
  serviceId: "verified-service",
  staffId: "verified-staff",
  startAt: "2026-08-31T09:00:00.000Z",
  customer: { name: "Айдана", phone: "77001234567" },
};
const appointment = {
  id: "provider-appointment-42",
  serviceId: "verified-service",
  staffId: "verified-staff",
  startAt: "2026-08-31T09:00:00.000Z",
  endAt: "2026-08-31T10:00:00.000Z",
  status: "confirmed" as const,
};
const success = { success: true as const, data: appointment };

function input() {
  return { organizationId: ORGANIZATION_ID, aiMessageRunId: RUN_ID, nowInstant: NOW };
}

function dependencies(
  overrides: Partial<AiBookingActionExecutorDependencies> = {},
): AiBookingActionExecutorDependencies {
  return {
    findBookingMutationExecution: async () => null,
    loadBookingActionSource: async () => ({
      success: true,
      source: {
        conversationId: CONVERSATION_ID,
        bookingIntent: "create_appointment",
        bookingRequest,
      },
    }),
    composeBookingRequestForOrganization: async () => ({
      status: "ready",
      request: trustedRequest,
    }),
    executeBookingForOrganization: async () => ({
      status: "executed",
      intent: "create_appointment",
      result: success,
    }),
    prepareBookingMutationExecution: async () => ({
      executionId: EXECUTION_ID,
      state: "prepared",
      result: null,
    }),
    claimBookingMutationExecution: async () => ({
      outcome: "claimed",
      executionId: EXECUTION_ID,
      trustedRequest,
    }),
    recordBookingMutationSuccess: async () => ({
      executionId: EXECUTION_ID,
      state: "succeeded",
      result: success,
    }),
    recordBookingMutationFailure: async (_identity, result) => ({
      executionId: EXECUTION_ID,
      state: "failed",
      result,
    }),
    markBookingMutationIndeterminate: async () => ({
      executionId: EXECUTION_ID,
      state: "indeterminate",
      result: { success: false, code: "provider_error", retryable: false },
    }),
    ...overrides,
  };
}

test("availability uses composition and existing execution path without a mutation journal", async () => {
  const slots = [{
    startAt: "2026-08-31T09:00:00.000Z",
    endAt: "2026-08-31T10:00:00.000Z",
    staffId: "provider-staff",
  }];
  let prepareCalls = 0;
  const result = await executeAiBookingActionCore(input(), dependencies({
    loadBookingActionSource: async () => ({
      success: true,
      source: {
        conversationId: CONVERSATION_ID,
        bookingIntent: "check_availability",
        bookingRequest,
      },
    }),
    composeBookingRequestForOrganization: async (compositionInput) => {
      assert.equal(compositionInput.nowInstant, NOW);
      return {
        status: "ready",
        request: {
          intent: "check_availability",
          serviceId: "verified-service",
          from: "2026-08-31T08:00:00.000Z",
          to: "2026-08-31T12:00:00.000Z",
        },
      };
    },
    executeBookingForOrganization: async ({ organizationId, request }) => {
      assert.equal(organizationId, ORGANIZATION_ID);
      assert.equal(request.intent, "check_availability");
      return {
        status: "executed",
        intent: "check_availability",
        result: { success: true, data: slots },
      };
    },
    prepareBookingMutationExecution: async () => {
      prepareCalls += 1;
      throw new Error("must not prepare");
    },
  }));

  assert.deepEqual(result, {
    status: "availability",
    result: { success: true, data: slots },
  });
  assert.equal(prepareCalls, 0);
});

test("verified create success is persisted with provider appointment ID", async () => {
  const executionRequests: unknown[] = [];
  const persisted: unknown[] = [];
  const result = await executeAiBookingActionCore(input(), dependencies({
    executeBookingForOrganization: async (executionInput) => {
      executionRequests.push(executionInput);
      return { status: "executed", intent: "create_appointment", result: success };
    },
    recordBookingMutationSuccess: async (identity, terminalResult) => {
      persisted.push({ identity, terminalResult });
      return { executionId: EXECUTION_ID, state: "succeeded", result: terminalResult };
    },
  }));

  assert.deepEqual(executionRequests, [{
    organizationId: ORGANIZATION_ID,
    request: trustedRequest,
  }]);
  assert.deepEqual(persisted, [{
    identity: { organizationId: ORGANIZATION_ID, executionId: EXECUTION_ID },
    terminalResult: success,
  }]);
  assert.deepEqual(result, { status: "create_succeeded", appointment });
  assert.equal(result.status === "create_succeeded" && result.appointment.id, "provider-appointment-42");
});

test("repeated terminal execution returns stored success without another provider call", async () => {
  let state: "prepared" | "succeeded" = "prepared";
  let providerCalls = 0;
  const deps = dependencies({
    claimBookingMutationExecution: async () => state === "prepared"
      ? { outcome: "claimed", executionId: EXECUTION_ID, trustedRequest }
      : { outcome: "succeeded", executionId: EXECUTION_ID, result: success },
    executeBookingForOrganization: async () => {
      providerCalls += 1;
      return { status: "executed", intent: "create_appointment", result: success };
    },
    recordBookingMutationSuccess: async () => {
      state = "succeeded";
      return { executionId: EXECUTION_ID, state: "succeeded", result: success };
    },
  });

  assert.deepEqual(await executeAiBookingActionCore(input(), deps), {
    status: "create_succeeded",
    appointment,
  });
  assert.deepEqual(await executeAiBookingActionCore(input(), deps), {
    status: "create_succeeded",
    appointment,
  });
  assert.equal(providerCalls, 1);
});

test("recovery replays durable terminal result before catalog, dates or provider execution", async () => {
  for (const state of ["succeeded", "failed", "indeterminate", "executing"] as const) {
    const result = state === "succeeded" ? success : {
      success: false as const, code: state === "failed" ? "slot_unavailable" as const : "provider_error" as const, retryable: false,
    };
    const recovered = await executeAiBookingActionCore(input(), dependencies({
      findBookingMutationExecution: async () => ({ executionId: EXECUTION_ID, state, result: state === "executing" ? null : result }),
      claimBookingMutationExecution: async () => state === "executing"
        ? { outcome: "already_executing", executionId: EXECUTION_ID }
        : { outcome: state, executionId: EXECUTION_ID, result },
      composeBookingRequestForOrganization: async () => { assert.fail("must not reinterpret yesterday's date"); },
      executeBookingForOrganization: async () => { assert.fail("must not retry create"); },
    }));
    assert.equal(recovered.status, state === "succeeded" ? "create_succeeded" : state === "failed" ? "create_failed" : state === "executing" ? "already_executing" : "indeterminate");
  }
});

test("concurrent claims allow at most one create mutation", async () => {
  let claimCalls = 0;
  let providerCalls = 0;
  const deps = dependencies({
    claimBookingMutationExecution: async () => {
      claimCalls += 1;
      return claimCalls === 1
        ? { outcome: "claimed", executionId: EXECUTION_ID, trustedRequest }
        : { outcome: "already_executing", executionId: EXECUTION_ID };
    },
    executeBookingForOrganization: async () => {
      providerCalls += 1;
      return { status: "executed", intent: "create_appointment", result: success };
    },
  });

  const results = await Promise.all([
    executeAiBookingActionCore(input(), deps),
    executeAiBookingActionCore(input(), deps),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [
    "already_executing",
    "create_succeeded",
  ]);
  assert.equal(providerCalls, 1);
});

test("definitive provider failure is persisted and returned", async () => {
  const failure = { success: false as const, code: "slot_unavailable" as const, retryable: false };
  let persisted = 0;
  const result = await executeAiBookingActionCore(input(), dependencies({
    executeBookingForOrganization: async () => ({
      status: "executed",
      intent: "create_appointment",
      result: failure,
    }),
    recordBookingMutationFailure: async (_identity, terminalResult) => {
      persisted += 1;
      return { executionId: EXECUTION_ID, state: "failed", result: terminalResult };
    },
  }));

  assert.deepEqual(result, { status: "create_failed", code: "slot_unavailable", retryable: false });
  assert.equal(persisted, 1);
});

test("provider_error and thrown uncertain outcomes become indeterminate", async () => {
  for (const executeBookingForOrganization of [
    async () => ({
      status: "executed" as const,
      intent: "create_appointment" as const,
      result: { success: false as const, code: "provider_error" as const, retryable: false },
    }),
    async () => { throw new Error("uncertain provider timeout"); },
  ]) {
    let indeterminateCalls = 0;
    const result = await executeAiBookingActionCore(input(), dependencies({
      executeBookingForOrganization,
      markBookingMutationIndeterminate: async () => {
        indeterminateCalls += 1;
        return {
          executionId: EXECUTION_ID,
          state: "indeterminate",
          result: { success: false, code: "provider_error", retryable: false },
        };
      },
    }));
    assert.deepEqual(result, { status: "indeterminate" });
    assert.equal(indeterminateCalls, 1);
  }
});

test("failed success persistence retries only the database and never creates twice", async () => {
  let providerCalls = 0;
  let persistenceCalls = 0;
  let state: "prepared" | "indeterminate" = "prepared";
  const deps = dependencies({
    claimBookingMutationExecution: async () => state === "prepared"
      ? { outcome: "claimed", executionId: EXECUTION_ID, trustedRequest }
      : {
          outcome: "indeterminate",
          executionId: EXECUTION_ID,
          result: { success: false, code: "provider_error", retryable: false },
        },
    executeBookingForOrganization: async () => {
      providerCalls += 1;
      return { status: "executed", intent: "create_appointment", result: success };
    },
    recordBookingMutationSuccess: async () => {
      persistenceCalls += 1;
      throw new Error("database unavailable after provider success");
    },
    markBookingMutationIndeterminate: async () => {
      state = "indeterminate";
      return {
        executionId: EXECUTION_ID,
        state: "indeterminate",
        result: { success: false, code: "provider_error", retryable: false },
      };
    },
  });

  assert.deepEqual(await executeAiBookingActionCore(input(), deps), { status: "indeterminate" });
  assert.deepEqual(await executeAiBookingActionCore(input(), deps), { status: "indeterminate" });
  assert.equal(persistenceCalls, 3);
  assert.equal(providerCalls, 1);
});

test("composition unresolved and safe failures propagate without execution", async () => {
  for (const composition of [
    { status: "needs_input" as const, field: "dateText" as const },
    { status: "needs_clarification" as const, field: "staffQuery" as const, options: ["Алексей"] },
    { status: "unavailable" as const, code: "time_context_unavailable" as const, retryable: false },
  ]) {
    let executionCalls = 0;
    const result = await executeAiBookingActionCore(input(), dependencies({
      composeBookingRequestForOrganization: async () => composition,
      executeBookingForOrganization: async () => {
        executionCalls += 1;
        throw new Error("must not execute");
      },
    }));
    assert.deepEqual(result, composition);
    assert.equal(executionCalls, 0);
  }
});

test("cancel and reschedule remain unsupported without composition or execution", async () => {
  for (const bookingIntent of ["cancel_appointment", "reschedule_appointment"] as const) {
    let downstreamCalls = 0;
    const result = await executeAiBookingActionCore(input(), dependencies({
      loadBookingActionSource: async () => ({
        success: true,
        source: { conversationId: CONVERSATION_ID, bookingIntent, bookingRequest },
      }),
      composeBookingRequestForOrganization: async () => {
        downstreamCalls += 1;
        throw new Error("must not compose");
      },
      executeBookingForOrganization: async () => {
        downstreamCalls += 1;
        throw new Error("must not execute");
      },
    }));
    assert.deepEqual(result, {
      status: "unavailable",
      code: "operation_not_supported",
      retryable: false,
    });
    assert.equal(downstreamCalls, 0);
  }
});

test("production entrypoint is server-only and contains no WhatsApp sending or provider shortcut", () => {
  const source = readFileSync(
    new URL("./ai-booking-action-executor.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /^import "server-only";/);
  assert.match(source, /new Date\(\)\.toISOString\(\)/);
  assert.match(source, /composeBookingRequestForOrganization/);
  assert.match(source, /executeBookingForOrganization/);
  assert.doesNotMatch(source, /DevelopmentProvider|sendWhatsapp|outbound|Meta/i);
});
