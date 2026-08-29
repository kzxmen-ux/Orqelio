import assert from "node:assert/strict";
import test from "node:test";

import {
  executeBookingForOrganizationCore,
  type BookingExecutionDependencies,
  type BookingExecutionInput,
} from "./booking-execution-core.ts";
import type { BookingOrchestratorResult } from "./booking-orchestrator-core.ts";
import type { SafeBookingTools } from "./safe-booking-tools-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const INPUT: BookingExecutionInput = {
  organizationId: ORGANIZATION_ID,
  request: { intent: "cancel_appointment", appointmentId: "appointment-1" },
};

async function safeFailure() {
  return {
    success: false,
    code: "provider_error",
    retryable: false,
  } as const;
}

function createTools(): SafeBookingTools {
  return Object.freeze({
    findServices: safeFailure,
    findStaff: safeFailure,
    findAvailableSlots: safeFailure,
    createAppointment: safeFailure,
    cancelAppointment: safeFailure,
    rescheduleAppointment: safeFailure,
  });
}

test("passes organizationId exactly to the resolver", async () => {
  let receivedOrganizationId: string | null = null;
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async (organizationId) => {
      receivedOrganizationId = organizationId;
      return {
        success: false,
        code: "connection_unavailable",
        retryable: false,
      };
    },
    executeBookingOrchestrator: async () => {
      throw new Error("must not run");
    },
  };

  await executeBookingForOrganizationCore(INPUT, dependencies);

  assert.equal(receivedOrganizationId, ORGANIZATION_ID);
});

test("preserves resolver failure and prevents orchestrator execution", async () => {
  let orchestratorCalls = 0;
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async () => ({
      success: false,
      code: "provider_unavailable",
      retryable: false,
    }),
    executeBookingOrchestrator: async () => {
      orchestratorCalls += 1;
      return { status: "needs_input", missingFields: [] };
    },
  };

  const result = await executeBookingForOrganizationCore(INPUT, dependencies);

  assert.deepEqual(result, {
    status: "unavailable",
    code: "provider_unavailable",
    retryable: false,
  });
  assert.equal(orchestratorCalls, 0);
});

test("passes only the request and resolved SafeBookingTools to the orchestrator", async () => {
  const tools = createTools();
  const received: {
    arguments:
      | readonly [BookingExecutionInput["request"], SafeBookingTools]
      | null;
  } = { arguments: null };
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async () => ({
      success: true,
      tools,
    }),
    executeBookingOrchestrator: async (...arguments_) => {
      received.arguments = arguments_;
      return { status: "needs_input", missingFields: ["appointmentId"] };
    },
  };

  await executeBookingForOrganizationCore(INPUT, dependencies);

  const receivedArguments = received.arguments;
  assert.notEqual(receivedArguments, null);
  if (receivedArguments === null) {
    return;
  }
  assert.equal(receivedArguments.length, 2);
  assert.equal(receivedArguments[0], INPUT.request);
  assert.equal(receivedArguments[1], tools);
});

test("returns the orchestrator result unchanged", async () => {
  const orchestratorResult: BookingOrchestratorResult = {
    status: "executed",
    intent: "cancel_appointment",
    result: {
      success: true,
      data: { appointmentId: "appointment-1", status: "cancelled" },
    },
  };
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async () => ({
      success: true,
      tools: createTools(),
    }),
    executeBookingOrchestrator: async () => orchestratorResult,
  };

  const result = await executeBookingForOrganizationCore(INPUT, dependencies);

  assert.equal(result, orchestratorResult);
});

test("contains an unexpected resolver exception as provider_error", async () => {
  let orchestratorCalls = 0;
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async () => {
      throw new Error("raw resolver details");
    },
    executeBookingOrchestrator: async () => {
      orchestratorCalls += 1;
      return { status: "needs_input", missingFields: [] };
    },
  };

  const result = await executeBookingForOrganizationCore(INPUT, dependencies);

  assert.deepEqual(result, {
    status: "unavailable",
    code: "provider_error",
    retryable: false,
  });
  assert.equal(orchestratorCalls, 0);
});

test("contains an unexpected orchestrator exception as provider_error", async () => {
  const dependencies: BookingExecutionDependencies = {
    resolveSafeBookingToolsForOrganization: async () => ({
      success: true,
      tools: createTools(),
    }),
    executeBookingOrchestrator: async () => {
      throw new Error("raw orchestrator details");
    },
  };

  const result = await executeBookingForOrganizationCore(INPUT, dependencies);

  assert.deepEqual(result, {
    status: "unavailable",
    code: "provider_error",
    retryable: false,
  });
});
