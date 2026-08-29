import assert from "node:assert/strict";
import test from "node:test";

import type {
  BookingProviderOperationResult,
  BookingProviderOperations,
} from "../crm-connections/providers/booking-operations";
import type { CrmConnection } from "../crm-connections/types";
import {
  createSafeBookingTools,
  type SafeBookingTools,
} from "./safe-booking-tools-core.ts";

const connection = {
  configuration: {},
  createdAt: "2026-08-29T00:00:00.000Z",
  displayName: "Trusted connection",
  id: "trusted-connection-id",
  lastSyncAt: null,
  organizationId: "trusted-organization-id",
  provider: "custom",
  status: "connected",
  updatedAt: "2026-08-29T00:00:00.000Z",
} satisfies CrmConnection;

type OperationCalls = {
  [Name in keyof BookingProviderOperations]: Array<
    Parameters<BookingProviderOperations[Name]>[0]
  >;
};

function createFakeOperations(): {
  calls: OperationCalls;
  operations: BookingProviderOperations;
} {
  const calls: OperationCalls = {
    listServices: [],
    listStaff: [],
    findAvailableSlots: [],
    createAppointment: [],
    cancelAppointment: [],
    rescheduleAppointment: [],
  };

  const operations = {
    async listServices(input) {
      calls.listServices.push(input);
      return {
        success: true,
        data: [
          {
            id: "service-id",
            name: "Service",
            durationMinutes: 60,
            priceMinor: 12_000,
            currency: "KZT",
            providerServiceCode: "raw-service-code",
          },
        ],
        providerEnvelope: "raw-services-envelope",
      };
    },
    async listStaff(input) {
      calls.listStaff.push(input);
      return {
        success: true,
        data: [
          {
            id: "staff-id",
            name: "Staff",
            providerStaffCode: "raw-staff-code",
          },
        ],
      };
    },
    async findAvailableSlots(input) {
      calls.findAvailableSlots.push(input);
      return {
        success: true,
        data: [
          {
            startAt: "2026-09-01T09:00:00.000Z",
            endAt: "2026-09-01T10:00:00.000Z",
            staffId: "staff-id",
            providerSlotToken: "raw-slot-token",
          },
        ],
      };
    },
    async createAppointment(input) {
      calls.createAppointment.push(input);
      return {
        success: true,
        data: {
          id: "appointment-id",
          serviceId: "service-id",
          staffId: "staff-id",
          startAt: "2026-09-01T09:00:00.000Z",
          endAt: "2026-09-01T10:00:00.000Z",
          status: "confirmed",
          providerPayload: "raw-create-payload",
        },
      };
    },
    async cancelAppointment(input) {
      calls.cancelAppointment.push(input);
      return {
        success: true,
        data: {
          appointmentId: "appointment-id",
          status: "cancelled",
          providerPayload: "raw-cancel-payload",
        },
      };
    },
    async rescheduleAppointment(input) {
      calls.rescheduleAppointment.push(input);
      return {
        success: true,
        data: {
          id: "appointment-id",
          serviceId: "service-id",
          staffId: "new-staff-id",
          startAt: "2026-09-02T11:00:00.000Z",
          endAt: "2026-09-02T12:00:00.000Z",
          status: "confirmed",
          providerPayload: "raw-reschedule-payload",
        },
      };
    },
  } satisfies BookingProviderOperations;

  return { calls, operations };
}

function replaceRuntimeOperation(
  operations: BookingProviderOperations,
  name: keyof BookingProviderOperations,
  implementation: (...input: readonly unknown[]) => unknown,
): void {
  Object.defineProperty(operations, name, {
    configurable: true,
    value: implementation,
  });
}

const providerError = {
  success: false,
  code: "provider_error",
  retryable: false,
} as const;

test("binds trusted connection and location for all six safe methods", async () => {
  const { calls, operations } = createFakeOperations();
  const tools = createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  });

  await tools.findServices();
  await tools.findStaff({ serviceId: "service-id" });
  await tools.findAvailableSlots({
    serviceId: "service-id",
    staffId: "staff-id",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
  });
  await tools.createAppointment({
    serviceId: "service-id",
    staffId: "staff-id",
    startAt: "2026-09-01T09:00:00.000Z",
    customer: { name: "Customer", phone: "+77000000000" },
  });
  await tools.cancelAppointment({ appointmentId: "appointment-id" });
  await tools.rescheduleAppointment({
    appointmentId: "appointment-id",
    staffId: "new-staff-id",
    startAt: "2026-09-02T11:00:00.000Z",
  });

  for (const operationCalls of Object.values(calls)) {
    assert.equal(operationCalls.length, 1);
    assert.equal(operationCalls[0]?.connection, connection);
    assert.equal(operationCalls[0]?.locationId, "trusted-location-id");
  }

  assert.deepEqual(calls.listServices[0], {
    connection,
    locationId: "trusted-location-id",
  });
  assert.deepEqual(calls.listStaff[0], {
    connection,
    locationId: "trusted-location-id",
    serviceId: "service-id",
  });
  assert.deepEqual(calls.findAvailableSlots[0], {
    connection,
    locationId: "trusted-location-id",
    serviceId: "service-id",
    staffId: "staff-id",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
  });
  assert.deepEqual(calls.createAppointment[0], {
    connection,
    locationId: "trusted-location-id",
    serviceId: "service-id",
    staffId: "staff-id",
    startAt: "2026-09-01T09:00:00.000Z",
    customer: { name: "Customer", phone: "+77000000000" },
  });
  assert.deepEqual(calls.cancelAppointment[0], {
    connection,
    locationId: "trusted-location-id",
    appointmentId: "appointment-id",
  });
  assert.deepEqual(calls.rescheduleAppointment[0], {
    connection,
    locationId: "trusted-location-id",
    appointmentId: "appointment-id",
    staffId: "new-staff-id",
    startAt: "2026-09-02T11:00:00.000Z",
  });
});

test("returns fresh normalized successes and drops provider-specific fields", async () => {
  const { operations } = createFakeOperations();
  const tools = createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  });

  assert.deepEqual(await tools.findServices(), {
    success: true,
    data: [
      {
        id: "service-id",
        name: "Service",
        durationMinutes: 60,
        priceMinor: 12_000,
        currency: "KZT",
      },
    ],
  });
  assert.deepEqual(await tools.findStaff(), {
    success: true,
    data: [{ id: "staff-id", name: "Staff" }],
  });
  assert.deepEqual(
    await tools.findAvailableSlots({
      serviceId: "service-id",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-02T00:00:00.000Z",
    }),
    {
      success: true,
      data: [
        {
          startAt: "2026-09-01T09:00:00.000Z",
          endAt: "2026-09-01T10:00:00.000Z",
          staffId: "staff-id",
        },
      ],
    },
  );
  assert.deepEqual(
    await tools.createAppointment({
      serviceId: "service-id",
      staffId: "staff-id",
      startAt: "2026-09-01T09:00:00.000Z",
      customer: { name: "Customer", phone: "+77000000000" },
    }),
    {
      success: true,
      data: {
        id: "appointment-id",
        serviceId: "service-id",
        staffId: "staff-id",
        startAt: "2026-09-01T09:00:00.000Z",
        endAt: "2026-09-01T10:00:00.000Z",
        status: "confirmed",
      },
    },
  );
  assert.deepEqual(
    await tools.cancelAppointment({ appointmentId: "appointment-id" }),
    {
      success: true,
      data: { appointmentId: "appointment-id", status: "cancelled" },
    },
  );
  assert.deepEqual(
    await tools.rescheduleAppointment({
      appointmentId: "appointment-id",
      staffId: "new-staff-id",
      startAt: "2026-09-02T11:00:00.000Z",
    }),
    {
      success: true,
      data: {
        id: "appointment-id",
        serviceId: "service-id",
        staffId: "new-staff-id",
        startAt: "2026-09-02T11:00:00.000Z",
        endAt: "2026-09-02T12:00:00.000Z",
        status: "confirmed",
      },
    },
  );
});

test("preserves normalized failures while dropping raw extra fields", async () => {
  const { operations } = createFakeOperations();
  replaceRuntimeOperation(operations, "findAvailableSlots", async () => ({
    success: false,
    code: "slot_unavailable",
    retryable: true,
    rawProviderError: "SENSITIVE_PROVIDER_FAILURE",
  }));

  const result = await createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  }).findAvailableSlots({
    serviceId: "service-id",
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
  });

  assert.deepEqual(result, {
    success: false,
    code: "slot_unavailable",
    retryable: true,
  });
  assert.equal(
    JSON.stringify(result).includes("SENSITIVE_PROVIDER_FAILURE"),
    false,
  );
});

test("contains synchronous and asynchronous provider exceptions", async () => {
  const { operations } = createFakeOperations();
  replaceRuntimeOperation(operations, "listServices", () => {
    throw new Error("SENSITIVE_READ_EXCEPTION");
  });
  replaceRuntimeOperation(operations, "createAppointment", async () => {
    throw new Error("SENSITIVE_CREATE_EXCEPTION");
  });
  replaceRuntimeOperation(operations, "cancelAppointment", () => {
    throw new Error("SENSITIVE_CANCEL_EXCEPTION");
  });
  replaceRuntimeOperation(operations, "rescheduleAppointment", () =>
    Promise.reject(new Error("SENSITIVE_RESCHEDULE_EXCEPTION")),
  );

  const tools = createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  });
  const results = [
    await tools.findServices(),
    await tools.createAppointment({
      serviceId: "service-id",
      staffId: "staff-id",
      startAt: "2026-09-01T09:00:00.000Z",
      customer: { name: "Customer", phone: "+77000000000" },
    }),
    await tools.cancelAppointment({ appointmentId: "appointment-id" }),
    await tools.rescheduleAppointment({
      appointmentId: "appointment-id",
      staffId: "staff-id",
      startAt: "2026-09-02T11:00:00.000Z",
    }),
  ];

  for (const result of results) {
    assert.deepEqual(result, providerError);
    assert.equal(JSON.stringify(result).includes("SENSITIVE"), false);
  }
});

test("converts malformed successes and failures to provider_error", async () => {
  const { operations } = createFakeOperations();
  replaceRuntimeOperation(operations, "listStaff", async () => ({
    success: true,
    data: [{ id: "staff-without-name" }],
  }));
  replaceRuntimeOperation(operations, "findAvailableSlots", async () => ({
    success: false,
    code: "unknown_provider_code",
    retryable: "yes",
    raw: "SENSITIVE_MALFORMED_FAILURE",
  }));

  const tools = createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  });
  assert.deepEqual(await tools.findStaff(), providerError);
  assert.deepEqual(
    await tools.findAvailableSlots({
      serviceId: "service-id",
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-02T00:00:00.000Z",
    }),
    providerError,
  );
});

type MutationName =
  | "createAppointment"
  | "cancelAppointment"
  | "rescheduleAppointment";

async function invokeMutation(
  tools: SafeBookingTools,
  mutation: MutationName,
): Promise<BookingProviderOperationResult<unknown>> {
  switch (mutation) {
    case "createAppointment":
      return tools.createAppointment({
        serviceId: "service-id",
        staffId: "staff-id",
        startAt: "2026-09-01T09:00:00.000Z",
        customer: { name: "Customer", phone: "+77000000000" },
      });
    case "cancelAppointment":
      return tools.cancelAppointment({ appointmentId: "appointment-id" });
    case "rescheduleAppointment":
      return tools.rescheduleAppointment({
        appointmentId: "appointment-id",
        staffId: "staff-id",
        startAt: "2026-09-02T11:00:00.000Z",
      });
  }
}

test("mutation success requires a valid successful provider result", async (t) => {
  const mutations: readonly MutationName[] = [
    "createAppointment",
    "cancelAppointment",
    "rescheduleAppointment",
  ];

  for (const mutation of mutations) {
    await t.test(`${mutation} preserves provider failure`, async () => {
      const { operations } = createFakeOperations();
      replaceRuntimeOperation(operations, mutation, async () => ({
        success: false,
        code: "slot_unavailable",
        retryable: true,
      }));

      assert.deepEqual(
        await invokeMutation(
          createSafeBookingTools({
            connection,
            locationId: "trusted-location-id",
            operations,
          }),
          mutation,
        ),
        { success: false, code: "slot_unavailable", retryable: true },
      );
    });

    await t.test(`${mutation} contains provider exception`, async () => {
      const { operations } = createFakeOperations();
      replaceRuntimeOperation(operations, mutation, async () => {
        throw new Error(`SENSITIVE_${mutation}_EXCEPTION`);
      });

      assert.deepEqual(
        await invokeMutation(
          createSafeBookingTools({
            connection,
            locationId: "trusted-location-id",
            operations,
          }),
          mutation,
        ),
        providerError,
      );
    });

    await t.test(`${mutation} rejects malformed success`, async () => {
      const { operations } = createFakeOperations();
      replaceRuntimeOperation(operations, mutation, async () => ({
        success: true,
        data: { providerOnly: "SENSITIVE_MALFORMED_SUCCESS" },
      }));

      assert.deepEqual(
        await invokeMutation(
          createSafeBookingTools({
            connection,
            locationId: "trusted-location-id",
            operations,
          }),
          mutation,
        ),
        providerError,
      );
    });
  }
});

test("safe tools expose only six frozen business methods", () => {
  const { operations } = createFakeOperations();
  const tools = createSafeBookingTools({
    connection,
    locationId: "trusted-location-id",
    operations,
  });

  assert.deepEqual(Object.keys(tools).sort(), [
    "cancelAppointment",
    "createAppointment",
    "findAvailableSlots",
    "findServices",
    "findStaff",
    "rescheduleAppointment",
  ]);
  assert.equal(Object.isFrozen(tools), true);
  assert.equal("connection" in tools, false);
  assert.equal("locationId" in tools, false);
  assert.equal("operations" in tools, false);
  assert.equal("provider" in tools, false);
});
