import assert from "node:assert/strict";
import test from "node:test";

import type { ModelBookingRequest } from "../ai-runtime/decision-types.ts";
import {
  resolveBookingCatalog,
  type BookingCatalogResolutionInput,
} from "./booking-catalog-resolution-core.ts";
import type { SafeBookingTools } from "./safe-booking-tools-core.ts";

type ToolCall =
  | { tool: "findServices" }
  | {
      tool: "findStaff";
      input: Parameters<SafeBookingTools["findStaff"]>[0];
    };

const BOOKING_REQUEST: ModelBookingRequest = {
  serviceQuery: "Стрижка",
  staffQuery: null,
  dateText: null,
  timeText: null,
  customerName: null,
  customerPhone: null,
  appointmentReference: null,
};

function input(
  overrides: Partial<ModelBookingRequest> = {},
  intent: BookingCatalogResolutionInput["intent"] = "check_availability",
): BookingCatalogResolutionInput {
  return {
    intent,
    bookingRequest: { ...BOOKING_REQUEST, ...overrides },
  };
}

function createTools(
  calls: ToolCall[] = [],
  overrides: Partial<SafeBookingTools> = {},
): SafeBookingTools {
  return {
    findServices: async () => {
      calls.push({ tool: "findServices" });
      return {
        success: true,
        data: [
          {
            id: "service-verified",
            name: "Стрижка",
            durationMinutes: 60,
            priceMinor: null,
            currency: null,
          },
        ],
      };
    },
    findStaff: async (staffInput) => {
      calls.push({ tool: "findStaff", input: staffInput });
      return {
        success: true,
        data: [{ id: "staff-verified", name: "Алексей" }],
      };
    },
    findAvailableSlots: async () => ({ success: true, data: [] }),
    createAppointment: async () => ({
      success: false,
      code: "operation_not_supported",
      retryable: false,
    }),
    cancelAppointment: async () => ({
      success: false,
      code: "operation_not_supported",
      retryable: false,
    }),
    rescheduleAppointment: async () => ({
      success: false,
      code: "operation_not_supported",
      retryable: false,
    }),
    ...overrides,
  };
}

test("missing serviceQuery returns needs_input without tool calls", async () => {
  for (const serviceQuery of [null, "   "] as const) {
    const calls: ToolCall[] = [];
    const result = await resolveBookingCatalog(
      input({ serviceQuery }),
      createTools(calls),
    );

    assert.deepEqual(result, {
      status: "needs_input",
      field: "serviceQuery",
    });
    assert.deepEqual(calls, []);
  }
});

test("normalizes case and repeated whitespace for unique service resolution", async () => {
  const calls: ToolCall[] = [];
  const result = await resolveBookingCatalog(
    input({ serviceQuery: "  сТрИжКа   БоРоДы  " }),
    createTools(calls, {
      findServices: async () => {
        calls.push({ tool: "findServices" });
        return {
          success: true,
          data: [
            {
              id: "service-from-provider",
              name: "Стрижка бороды",
              durationMinutes: 30,
              priceMinor: null,
              currency: null,
            },
          ],
        };
      },
    }),
  );

  assert.deepEqual(result, {
    status: "resolved",
    serviceId: "service-from-provider",
    staffId: null,
  });
  assert.deepEqual(calls, [{ tool: "findServices" }]);
});

test("zero service matches returns safe display-name options only", async () => {
  const result = await resolveBookingCatalog(
    input({ serviceQuery: "Маникюр" }),
    createTools([], {
      findServices: async () => ({
        success: true,
        data: [
          {
            id: "secret-service-1",
            name: "  Стрижка   бороды ",
            durationMinutes: 30,
            priceMinor: null,
            currency: null,
          },
          {
            id: "secret-service-2",
            name: "Укладка",
            durationMinutes: 45,
            priceMinor: null,
            currency: null,
          },
        ],
      }),
    }),
  );

  assert.deepEqual(result, {
    status: "needs_clarification",
    field: "serviceQuery",
    options: ["Стрижка бороды", "Укладка"],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-service/);
});

test("ambiguous service names are never resolved by choosing an ID", async () => {
  const calls: ToolCall[] = [];
  const result = await resolveBookingCatalog(
    input(),
    createTools(calls, {
      findServices: async () => {
        calls.push({ tool: "findServices" });
        return {
          success: true,
          data: [
            {
              id: "service-1",
              name: "Стрижка",
              durationMinutes: 30,
              priceMinor: null,
              currency: null,
            },
            {
              id: "service-2",
              name: " стрижка ",
              durationMinutes: 60,
              priceMinor: null,
              currency: null,
            },
          ],
        };
      },
    }),
  );

  assert.deepEqual(result, {
    status: "needs_clarification",
    field: "serviceQuery",
    options: ["Стрижка"],
  });
  assert.deepEqual(calls, [{ tool: "findServices" }]);
});

test("check availability without staff resolves any staff without lookup", async () => {
  const calls: ToolCall[] = [];
  const result = await resolveBookingCatalog(input(), createTools(calls));

  assert.deepEqual(result, {
    status: "resolved",
    serviceId: "service-verified",
    staffId: null,
  });
  assert.deepEqual(calls, [{ tool: "findServices" }]);
});

test("supplied staff is matched only inside the verified service", async () => {
  const calls: ToolCall[] = [];
  const result = await resolveBookingCatalog(
    input({ staffQuery: "  аЛеКсЕй   Петров " }),
    createTools(calls, {
      findStaff: async (staffInput) => {
        calls.push({ tool: "findStaff", input: staffInput });
        return {
          success: true,
          data: [
            { id: "staff-from-provider", name: "Алексей Петров" },
            { id: "staff-other", name: "Мария" },
          ],
        };
      },
    }),
  );

  assert.deepEqual(result, {
    status: "resolved",
    serviceId: "service-verified",
    staffId: "staff-from-provider",
  });
  assert.deepEqual(calls, [
    { tool: "findServices" },
    { tool: "findStaff", input: { serviceId: "service-verified" } },
  ]);
});

test("create without staff auto-resolves only one returned member", async () => {
  const calls: ToolCall[] = [];
  const result = await resolveBookingCatalog(
    input({}, "create_appointment"),
    createTools(calls),
  );

  assert.deepEqual(result, {
    status: "resolved",
    serviceId: "service-verified",
    staffId: "staff-verified",
  });
  assert.deepEqual(calls, [
    { tool: "findServices" },
    { tool: "findStaff", input: { serviceId: "service-verified" } },
  ]);
});

test("multiple staff require clarification with names only", async () => {
  const result = await resolveBookingCatalog(
    input({}, "create_appointment"),
    createTools([], {
      findStaff: async () => ({
        success: true,
        data: [
          { id: "secret-staff-1", name: " Алексей " },
          { id: "secret-staff-2", name: "Мария" },
        ],
      }),
    }),
  );

  assert.deepEqual(result, {
    status: "needs_clarification",
    field: "staffQuery",
    options: ["Алексей", "Мария"],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-staff/);
});

test("zero or ambiguous supplied staff matches require clarification", async () => {
  for (const staffQuery of ["Неизвестный", "Алексей"] as const) {
    const staff =
      staffQuery === "Алексей"
        ? [
            { id: "staff-1", name: "Алексей" },
            { id: "staff-2", name: " алексей " },
          ]
        : [{ id: "staff-3", name: "Мария" }];
    const result = await resolveBookingCatalog(
      input({ staffQuery }),
      createTools([], {
        findStaff: async () => ({ success: true, data: staff }),
      }),
    );

    assert.equal(result.status, "needs_clarification");
    if (result.status === "needs_clarification") {
      assert.equal(result.field, "staffQuery");
      assert.equal(Object.hasOwn(result, "staffId"), false);
    }
  }
});

test("create with an empty staff list returns safe not_found", async () => {
  const result = await resolveBookingCatalog(
    input({}, "create_appointment"),
    createTools([], {
      findStaff: async () => ({ success: true, data: [] }),
    }),
  );

  assert.deepEqual(result, {
    status: "failed",
    code: "not_found",
    retryable: false,
  });
});

test("preserves Safe Booking Tool failures", async () => {
  const serviceFailure = {
    success: false,
    code: "connection_unavailable",
    retryable: true,
  } as const;
  assert.deepEqual(
    await resolveBookingCatalog(
      input(),
      createTools([], { findServices: async () => serviceFailure }),
    ),
    {
      status: "failed",
      code: "connection_unavailable",
      retryable: true,
    },
  );

  const staffFailure = {
    success: false,
    code: "operation_not_supported",
    retryable: false,
  } as const;
  assert.deepEqual(
    await resolveBookingCatalog(
      input({ staffQuery: "Алексей" }),
      createTools([], { findStaff: async () => staffFailure }),
    ),
    {
      status: "failed",
      code: "operation_not_supported",
      retryable: false,
    },
  );
});

test("contains thrown tool exceptions as safe provider_error", async () => {
  for (const tools of [
    createTools([], {
      findServices: async () => {
        throw new Error("raw service provider details");
      },
    }),
    createTools([], {
      findStaff: async () => {
        throw new Error("raw staff provider details");
      },
    }),
  ]) {
    const result = await resolveBookingCatalog(
      input({ staffQuery: "Алексей" }),
      tools,
    );
    assert.deepEqual(result, {
      status: "failed",
      code: "provider_error",
      retryable: false,
    });
  }
});
