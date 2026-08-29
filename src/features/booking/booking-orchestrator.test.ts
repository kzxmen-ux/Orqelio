import assert from "node:assert/strict";
import test from "node:test";

import {
  executeBookingOrchestrator,
  type BookingOrchestratorInput,
  type BookingOrchestratorMissingField,
} from "./booking-orchestrator-core.ts";
import type { SafeBookingTools } from "./safe-booking-tools-core.ts";

type ToolCall =
  | { tool: "findServices" }
  | {
      tool: "findStaff";
      input: Parameters<SafeBookingTools["findStaff"]>[0];
    }
  | { tool: "findAvailableSlots"; input: Parameters<SafeBookingTools["findAvailableSlots"]>[0] }
  | { tool: "createAppointment"; input: Parameters<SafeBookingTools["createAppointment"]>[0] }
  | { tool: "cancelAppointment"; input: Parameters<SafeBookingTools["cancelAppointment"]>[0] }
  | { tool: "rescheduleAppointment"; input: Parameters<SafeBookingTools["rescheduleAppointment"]>[0] };

function createTools(
  calls: ToolCall[] = [],
  overrides: Partial<SafeBookingTools> = {},
): SafeBookingTools {
  return {
    findServices: async () => {
      calls.push({ tool: "findServices" });
      return { success: true, data: [] };
    },
    findStaff: async (input) => {
      calls.push({ tool: "findStaff", input });
      return { success: true, data: [] };
    },
    findAvailableSlots: async (input) => {
      calls.push({ tool: "findAvailableSlots", input });
      return { success: true, data: [] };
    },
    createAppointment: async (input) => {
      calls.push({ tool: "createAppointment", input });
      return {
        success: true,
        data: {
          id: "appointment-1",
          serviceId: input.serviceId,
          staffId: input.staffId,
          startAt: input.startAt,
          endAt: input.startAt,
          status: "confirmed",
        },
      };
    },
    cancelAppointment: async (input) => {
      calls.push({ tool: "cancelAppointment", input });
      return {
        success: true,
        data: { appointmentId: input.appointmentId, status: "cancelled" },
      };
    },
    rescheduleAppointment: async (input) => {
      calls.push({ tool: "rescheduleAppointment", input });
      return {
        success: true,
        data: {
          id: input.appointmentId,
          serviceId: "service-1",
          staffId: input.staffId,
          startAt: input.startAt,
          endAt: input.startAt,
          status: "confirmed",
        },
      };
    },
    ...overrides,
  };
}

test("returns deterministically ordered missing fields for all intents without tool calls", async () => {
  const cases: readonly {
    input: BookingOrchestratorInput;
    missingFields: readonly BookingOrchestratorMissingField[];
  }[] = [
    {
      input: { intent: "check_availability" },
      missingFields: ["serviceId", "from", "to"],
    },
    {
      input: { intent: "create_appointment" },
      missingFields: [
        "serviceId",
        "staffId",
        "startAt",
        "customer.name",
        "customer.phone",
      ],
    },
    {
      input: { intent: "cancel_appointment" },
      missingFields: ["appointmentId"],
    },
    {
      input: { intent: "reschedule_appointment" },
      missingFields: ["appointmentId", "staffId", "startAt"],
    },
  ];
  const calls: ToolCall[] = [];
  const tools = createTools(calls);

  for (const current of cases) {
    const result = await executeBookingOrchestrator(current.input, tools);
    assert.deepEqual(result, {
      status: "needs_input",
      missingFields: current.missingFields,
    });
  }

  assert.deepEqual(calls, []);
});

test("treats whitespace required values as missing and does not call tools", async () => {
  const calls: ToolCall[] = [];
  const result = await executeBookingOrchestrator(
    {
      intent: "create_appointment",
      serviceId: "  ",
      staffId: "\t",
      startAt: "\n",
      customer: { name: " ", phone: "   " },
    },
    createTools(calls),
  );

  assert.deepEqual(result, {
    status: "needs_input",
    missingFields: [
      "serviceId",
      "staffId",
      "startAt",
      "customer.name",
      "customer.phone",
    ],
  });
  assert.deepEqual(calls, []);
});

test("calls findAvailableSlots with normalized complete input", async () => {
  const calls: ToolCall[] = [];
  const result = await executeBookingOrchestrator(
    {
      intent: "check_availability",
      serviceId: " service-1 ",
      staffId: " staff-1 ",
      from: " 2026-09-01T09:00:00Z ",
      to: " 2026-09-01T18:00:00Z ",
    },
    createTools(calls),
  );

  assert.equal(result.status, "executed");
  assert.deepEqual(calls, [
    {
      tool: "findAvailableSlots",
      input: {
        serviceId: "service-1",
        staffId: "staff-1",
        from: "2026-09-01T09:00:00Z",
        to: "2026-09-01T18:00:00Z",
      },
    },
  ]);
});

test("calls each mutation tool with normalized complete input", async () => {
  const calls: ToolCall[] = [];
  const tools = createTools(calls);

  await executeBookingOrchestrator(
    {
      intent: "create_appointment",
      serviceId: " service-1 ",
      staffId: " staff-1 ",
      startAt: " 2026-09-01T09:00:00Z ",
      customer: { name: " Customer ", phone: " +77000000000 " },
    },
    tools,
  );
  await executeBookingOrchestrator(
    { intent: "cancel_appointment", appointmentId: " appointment-1 " },
    tools,
  );
  await executeBookingOrchestrator(
    {
      intent: "reschedule_appointment",
      appointmentId: " appointment-1 ",
      staffId: " staff-2 ",
      startAt: " 2026-09-02T10:00:00Z ",
    },
    tools,
  );

  assert.deepEqual(calls, [
    {
      tool: "createAppointment",
      input: {
        serviceId: "service-1",
        staffId: "staff-1",
        startAt: "2026-09-01T09:00:00Z",
        customer: { name: "Customer", phone: "+77000000000" },
      },
    },
    {
      tool: "cancelAppointment",
      input: { appointmentId: "appointment-1" },
    },
    {
      tool: "rescheduleAppointment",
      input: {
        appointmentId: "appointment-1",
        staffId: "staff-2",
        startAt: "2026-09-02T10:00:00Z",
      },
    },
  ]);
});

test("preserves a Safe Booking Tool mutation failure", async () => {
  const toolFailure = {
    success: false,
    code: "slot_unavailable",
    retryable: false,
  } as const;
  const tools = createTools([], {
    createAppointment: async () => toolFailure,
  });
  const result = await executeBookingOrchestrator(
    {
      intent: "create_appointment",
      serviceId: "service-1",
      staffId: "staff-1",
      startAt: "2026-09-01T09:00:00Z",
      customer: { name: "Customer", phone: "+77000000000" },
    },
    tools,
  );

  assert.equal(result.status, "executed");
  if (result.status === "executed") {
    assert.equal(result.result, toolFailure);
  }
});

test("reports mutation success only from the exact Safe Booking Tool success", async () => {
  const toolSuccess = {
    success: true,
    data: {
      appointmentId: "appointment-1",
      status: "cancelled",
    },
  } as const;
  const tools = createTools([], {
    cancelAppointment: async () => toolSuccess,
  });
  const result = await executeBookingOrchestrator(
    { intent: "cancel_appointment", appointmentId: "appointment-1" },
    tools,
  );

  assert.equal(result.status, "executed");
  if (result.status === "executed") {
    assert.equal(result.result, toolSuccess);
  }
});

test("contains unexpected tool exceptions as provider_error", async () => {
  const tools = createTools([], {
    rescheduleAppointment: async () => {
      throw new Error("raw provider details");
    },
  });
  const result = await executeBookingOrchestrator(
    {
      intent: "reschedule_appointment",
      appointmentId: "appointment-1",
      staffId: "staff-1",
      startAt: "2026-09-01T09:00:00Z",
    },
    tools,
  );

  assert.deepEqual(result, {
    status: "executed",
    intent: "reschedule_appointment",
    result: {
      success: false,
      code: "provider_error",
      retryable: false,
    },
  });
});
