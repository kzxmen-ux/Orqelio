import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ModelBookingRequest } from "../ai-runtime/decision-types.ts";
import { resolveBookingCatalog } from "./booking-catalog-resolution-core.ts";
import {
  composeBookingRequestForOrganizationCore,
  type BookingRequestCompositionDependencies,
  type BookingRequestCompositionInput,
} from "./booking-request-composition-core.ts";
import type { BookingTemporalResolutionResult } from "./booking-temporal-resolution-core.ts";
import type { SafeBookingTools } from "./safe-booking-tools-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const NOW_INSTANT = "2026-08-30T08:00:00Z";
const BOOKING_REQUEST: ModelBookingRequest = {
  serviceQuery: "Стрижка",
  staffQuery: "Алексей",
  dateText: "завтра",
  timeText: "15:00",
  customerName: "Айдана",
  customerPhone: "+7 777 000 00 00",
  appointmentReference: null,
};

type ToolCalls = {
  findServices: number;
  findStaff: number;
  findAvailableSlots: number;
  createAppointment: number;
  cancelAppointment: number;
  rescheduleAppointment: number;
};

function input(
  bookingIntent: BookingRequestCompositionInput["bookingIntent"],
  bookingRequest: Partial<ModelBookingRequest> = {},
): BookingRequestCompositionInput {
  return {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    bookingIntent,
    bookingRequest: { ...BOOKING_REQUEST, ...bookingRequest },
    nowInstant: NOW_INSTANT,
  };
}

function createTools(): { tools: SafeBookingTools; calls: ToolCalls } {
  const calls: ToolCalls = {
    findServices: 0,
    findStaff: 0,
    findAvailableSlots: 0,
    createAppointment: 0,
    cancelAppointment: 0,
    rescheduleAppointment: 0,
  };
  const tools: SafeBookingTools = {
    findServices: async () => {
      calls.findServices += 1;
      return {
        success: true,
        data: [
          {
            id: "verified-service-id",
            name: "Стрижка",
            durationMinutes: 60,
            priceMinor: null,
            currency: null,
          },
        ],
      };
    },
    findStaff: async () => {
      calls.findStaff += 1;
      return {
        success: true,
        data: [{ id: "verified-staff-id", name: "Алексей" }],
      };
    },
    findAvailableSlots: async () => {
      calls.findAvailableSlots += 1;
      return { success: true, data: [] };
    },
    createAppointment: async () => {
      calls.createAppointment += 1;
      return {
        success: false,
        code: "operation_not_supported",
        retryable: false,
      };
    },
    cancelAppointment: async () => {
      calls.cancelAppointment += 1;
      return {
        success: false,
        code: "operation_not_supported",
        retryable: false,
      };
    },
    rescheduleAppointment: async () => {
      calls.rescheduleAppointment += 1;
      return {
        success: false,
        code: "operation_not_supported",
        retryable: false,
      };
    },
  };

  return { tools, calls };
}

function temporalResult(
  intent: "check_availability" | "create_appointment",
): BookingTemporalResolutionResult {
  return intent === "check_availability"
    ? {
        status: "resolved",
        intent,
        localDate: "2026-08-31",
        localTime: "15:00",
        from: "2026-08-31T10:00:00Z",
        to: "2026-08-31T19:00:00Z",
        requestedStartAt: "2026-08-31T10:00:00Z",
      }
    : {
        status: "resolved",
        intent,
        localDate: "2026-08-31",
        localTime: "15:00",
        startAt: "2026-08-31T10:00:00Z",
      };
}

function dependencies(
  tools: SafeBookingTools,
  overrides: Partial<BookingRequestCompositionDependencies> = {},
): BookingRequestCompositionDependencies {
  return {
    loadBookingTimeContextForOrganization: async () => ({
      success: true,
      context: { timeZone: "Asia/Almaty" },
    }),
    resolveBookingTemporal: ({ intent }) => temporalResult(intent),
    resolveSafeBookingToolsForOrganization: async () => ({
      success: true,
      tools,
    }),
    resolveBookingCatalog,
    loadBookingCustomerContext: async () => ({
      success: true,
      context: { phone: "77001234567", displayName: "Trusted Name" },
    }),
    ...overrides,
  };
}

function assertNoProviderExecution(calls: ToolCalls): void {
  assert.equal(calls.findAvailableSlots, 0);
  assert.equal(calls.createAppointment, 0);
  assert.equal(calls.cancelAppointment, 0);
  assert.equal(calls.rescheduleAppointment, 0);
}

test("availability composes provider-verified IDs and the trusted UTC range", async () => {
  const { tools, calls } = createTools();
  const operations: string[] = [];
  const compositionInput = input("check_availability");
  const result = await composeBookingRequestForOrganizationCore(
    compositionInput,
    dependencies(tools, {
      loadBookingTimeContextForOrganization: async (organizationId) => {
        operations.push(`time:${organizationId}`);
        return { success: true, context: { timeZone: "Asia/Almaty" } };
      },
      resolveBookingTemporal: (temporalInput) => {
        operations.push(`temporal:${temporalInput.nowInstant}`);
        assert.equal(temporalInput.bookingRequest, compositionInput.bookingRequest);
        assert.deepEqual(temporalInput.timeContext, { timeZone: "Asia/Almaty" });
        return temporalResult("check_availability");
      },
      resolveSafeBookingToolsForOrganization: async (organizationId) => {
        operations.push(`tools:${organizationId}`);
        return { success: true, tools };
      },
      resolveBookingCatalog: async (catalogInput, receivedTools) => {
        operations.push(`catalog:${catalogInput.intent}`);
        assert.equal(receivedTools, tools);
        return resolveBookingCatalog(catalogInput, receivedTools);
      },
    }),
  );

  assert.deepEqual(result, {
    status: "ready",
    request: {
      intent: "check_availability",
      serviceId: "verified-service-id",
      staffId: "verified-staff-id",
      from: "2026-08-31T10:00:00Z",
      to: "2026-08-31T19:00:00Z",
    },
  });
  assert.deepEqual(operations, [
    `time:${ORGANIZATION_ID}`,
    `temporal:${NOW_INSTANT}`,
    `tools:${ORGANIZATION_ID}`,
    "catalog:check_availability",
  ]);
  assert.equal(calls.findServices, 1);
  assert.equal(calls.findStaff, 1);
  assertNoProviderExecution(calls);
});

test("availability without staff omits staffId", async () => {
  const { tools, calls } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("check_availability", { staffQuery: null }),
    dependencies(tools),
  );

  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.deepEqual(result.request, {
      intent: "check_availability",
      serviceId: "verified-service-id",
      from: "2026-08-31T10:00:00Z",
      to: "2026-08-31T19:00:00Z",
    });
    assert.equal(Object.hasOwn(result.request, "staffId"), false);
  }
  assert.equal(calls.findStaff, 0);
  assertNoProviderExecution(calls);
});

test("create composes verified IDs, trusted startAt and trusted customer phone", async () => {
  const { tools, calls } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("create_appointment", {
      customerName: "  AI Name  ",
      customerPhone: "+1-untrusted-ai-phone",
    }),
    dependencies(tools, {
      loadBookingCustomerContext: async (organizationId, conversationId) => {
        assert.equal(organizationId, ORGANIZATION_ID);
        assert.equal(conversationId, CONVERSATION_ID);
        return {
          success: true,
          context: { phone: "77009998877", displayName: "Trusted Name" },
        };
      },
    }),
  );

  assert.deepEqual(result, {
    status: "ready",
    request: {
      intent: "create_appointment",
      serviceId: "verified-service-id",
      staffId: "verified-staff-id",
      startAt: "2026-08-31T10:00:00Z",
      customer: { name: "AI Name", phone: "77009998877" },
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /untrusted-ai-phone/);
  assertNoProviderExecution(calls);
});

test("trusted WhatsApp display name is the fallback when AI name is empty", async () => {
  const { tools, calls } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("create_appointment", { customerName: "   " }),
    dependencies(tools, {
      loadBookingCustomerContext: async () => ({
        success: true,
        context: { phone: "77001234567", displayName: "  Trusted Name  " },
      }),
    }),
  );

  assert.equal(result.status, "ready");
  if (result.status === "ready" && result.request.intent === "create_appointment") {
    assert.deepEqual(result.request.customer, {
      name: "Trusted Name",
      phone: "77001234567",
    });
  }
  assertNoProviderExecution(calls);
});

test("missing both customer names returns needs_input", async () => {
  const { tools, calls } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("create_appointment", { customerName: null }),
    dependencies(tools, {
      loadBookingCustomerContext: async () => ({
        success: true,
        context: { phone: "77001234567", displayName: null },
      }),
    }),
  );

  assert.deepEqual(result, { status: "needs_input", field: "customerName" });
  assertNoProviderExecution(calls);
});

test("catalog clarification propagates display names without provider IDs", async () => {
  const { tools, calls } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("check_availability"),
    dependencies(tools, {
      resolveBookingCatalog: async () => ({
        status: "needs_clarification",
        field: "staffQuery",
        options: ["Алексей", "Мария"],
      }),
    }),
  );

  assert.deepEqual(result, {
    status: "needs_clarification",
    field: "staffQuery",
    options: ["Алексей", "Мария"],
  });
  assert.doesNotMatch(JSON.stringify(result), /service-id|staff-id|provider/i);
  assertNoProviderExecution(calls);
});

test("temporal needs_input and clarification stop before tools or catalog resolution", async () => {
  for (const temporal of [
    { status: "needs_input", field: "dateText" },
    { status: "needs_clarification", field: "timeText" },
  ] as const) {
    const { tools, calls } = createTools();
    let toolsCalls = 0;
    let catalogCalls = 0;
    const result = await composeBookingRequestForOrganizationCore(
      input("check_availability"),
      dependencies(tools, {
        resolveBookingTemporal: () => temporal,
        resolveSafeBookingToolsForOrganization: async () => {
          toolsCalls += 1;
          return { success: true, tools };
        },
        resolveBookingCatalog: async () => {
          catalogCalls += 1;
          return {
            status: "resolved",
            serviceId: "must-not-resolve",
            staffId: null,
          };
        },
      }),
    );

    assert.deepEqual(result, temporal);
    assert.equal(toolsCalls, 0);
    assert.equal(catalogCalls, 0);
    assertNoProviderExecution(calls);
  }
});

test("time, provider, catalog, and customer failures propagate safely", async () => {
  const { tools } = createTools();

  assert.deepEqual(
    await composeBookingRequestForOrganizationCore(
      input("check_availability"),
      dependencies(tools, {
        loadBookingTimeContextForOrganization: async () => ({
          success: false,
          code: "time_context_unavailable",
        }),
      }),
    ),
    {
      status: "unavailable",
      code: "time_context_unavailable",
      retryable: false,
    },
  );

  assert.deepEqual(
    await composeBookingRequestForOrganizationCore(
      input("check_availability"),
      dependencies(tools, {
        resolveSafeBookingToolsForOrganization: async () => ({
          success: false,
          code: "connection_unavailable",
          retryable: false,
        }),
      }),
    ),
    {
      status: "unavailable",
      code: "connection_unavailable",
      retryable: false,
    },
  );

  assert.deepEqual(
    await composeBookingRequestForOrganizationCore(
      input("check_availability"),
      dependencies(tools, {
        resolveBookingCatalog: async () => ({
          status: "failed",
          code: "provider_unavailable",
          retryable: true,
        }),
      }),
    ),
    {
      status: "unavailable",
      code: "provider_unavailable",
      retryable: true,
    },
  );

  assert.deepEqual(
    await composeBookingRequestForOrganizationCore(
      input("create_appointment"),
      dependencies(tools, {
        loadBookingCustomerContext: async () => ({
          success: false,
          code: "customer_context_unavailable",
        }),
      }),
    ),
    {
      status: "unavailable",
      code: "customer_context_unavailable",
      retryable: false,
    },
  );
});

test("dependency exceptions become a generic safe unavailable result", async () => {
  const { tools } = createTools();
  const result = await composeBookingRequestForOrganizationCore(
    input("check_availability"),
    dependencies(tools, {
      loadBookingTimeContextForOrganization: async () => {
        throw new Error("raw database and provider details");
      },
    }),
  );

  assert.deepEqual(result, {
    status: "unavailable",
    code: "provider_error",
    retryable: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /database|provider details/i);
});

test("cancel and reschedule short-circuit without calling any resolver", async () => {
  for (const bookingIntent of [
    "cancel_appointment",
    "reschedule_appointment",
  ] as const) {
    const { calls } = createTools();
    let dependencyCalls = 0;
    const failIfCalled = async () => {
      dependencyCalls += 1;
      throw new Error("must not run");
    };
    const result = await composeBookingRequestForOrganizationCore(
      input(bookingIntent),
      {
        loadBookingTimeContextForOrganization: failIfCalled,
        resolveBookingTemporal: () => {
          dependencyCalls += 1;
          throw new Error("must not run");
        },
        resolveSafeBookingToolsForOrganization: failIfCalled,
        resolveBookingCatalog: failIfCalled,
        loadBookingCustomerContext: failIfCalled,
      },
    );

    assert.deepEqual(result, {
      status: "unavailable",
      code: "operation_not_supported",
      retryable: false,
    });
    assert.equal(dependencyCalls, 0);
    assertNoProviderExecution(calls);
  }
});

test("production composition is server-only and contains no execution path", () => {
  const wrapper = readFileSync(
    new URL("./booking-request-composition.ts", import.meta.url),
    "utf8",
  );
  const core = readFileSync(
    new URL("./booking-request-composition-core.ts", import.meta.url),
    "utf8",
  );

  assert.match(wrapper, /^import "server-only";/);
  for (const dependency of [
    "resolveSafeBookingToolsForOrganization",
    "resolveBookingCatalog",
    "loadBookingTimeContextForOrganization",
    "resolveBookingTemporal",
    "loadBookingCustomerContext",
  ]) {
    assert.match(wrapper, new RegExp(dependency));
  }
  assert.doesNotMatch(
    `${wrapper}\n${core}`,
    /createAppointment|findAvailableSlots|executeBookingOrchestrator|appointmentReference|customerPhone/,
  );
});
