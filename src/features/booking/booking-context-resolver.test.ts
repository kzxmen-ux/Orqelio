import assert from "node:assert/strict";
import test from "node:test";

import type { CrmConnection } from "../crm-connections/types";
import {
  resolveSafeBookingToolsForOrganizationCore,
  type BookingContextResolverDependencies,
} from "./booking-context-resolver-core.ts";
import type { TrustedBookingExecutionContext } from "./safe-booking-tools-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function createConnection(
  overrides: Partial<CrmConnection> = {},
): CrmConnection {
  return {
    configuration: { locationIds: ["location-1"] },
    createdAt: "2026-08-29T00:00:00.000Z",
    displayName: "Test CRM",
    id: "22222222-2222-4222-8222-222222222222",
    lastSyncAt: null,
    organizationId: ORGANIZATION_ID,
    provider: "custom",
    status: "connected",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function createOperations(
  serviceCalls: Array<{
    connection: CrmConnection;
    locationId: string;
  }> = [],
): TrustedBookingExecutionContext["operations"] {
  return {
    listServices: async (input) => {
      serviceCalls.push(input);
      return {
        success: true,
        data: [
          {
            id: "service-1",
            name: "Service",
            durationMinutes: 30,
            priceMinor: null,
            currency: null,
          },
        ],
      };
    },
    listStaff: async () => ({ success: true, data: [] }),
    findAvailableSlots: async () => ({ success: true, data: [] }),
    createAppointment: async (input) => ({
      success: true,
      data: {
        id: "appointment-1",
        serviceId: input.serviceId,
        staffId: input.staffId,
        startAt: input.startAt,
        endAt: input.startAt,
        status: "confirmed",
      },
    }),
    cancelAppointment: async (input) => ({
      success: true,
      data: { appointmentId: input.appointmentId, status: "cancelled" },
    }),
    rescheduleAppointment: async (input) => ({
      success: true,
      data: {
        id: input.appointmentId,
        serviceId: "service-1",
        staffId: input.staffId,
        startAt: input.startAt,
        endAt: input.startAt,
        status: "confirmed",
      },
    }),
  };
}

function createDependencies(
  connections: readonly CrmConnection[],
  operations: TrustedBookingExecutionContext["operations"] | undefined =
    createOperations(),
): BookingContextResolverDependencies {
  return {
    loadConnections: async () => connections,
    getProvider: () =>
      operations === undefined ? {} : { operations },
  };
}

test("resolves one connected connection and binds its location", async () => {
  const connection = createConnection({
    configuration: { locationIds: ["dev-location-1"] },
  });
  const serviceCalls: Array<{
    connection: CrmConnection;
    locationId: string;
  }> = [];
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([connection], createOperations(serviceCalls)),
  );

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  const toolResult = await result.tools.findServices();
  assert.equal(toolResult.success, true);
  assert.deepEqual(serviceCalls, [
    { connection, locationId: "dev-location-1" },
  ]);
});

test("returns connection_unavailable when no connected connection exists", async () => {
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([
      createConnection({ status: "draft" }),
      createConnection({ status: "disconnected" }),
    ]),
  );

  assert.deepEqual(result, {
    success: false,
    code: "connection_unavailable",
    retryable: false,
  });
});

test("returns connection_unavailable instead of guessing between connected connections", async () => {
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([
      createConnection(),
      createConnection({ id: "33333333-3333-4333-8333-333333333333" }),
    ]),
  );

  assert.deepEqual(result, {
    success: false,
    code: "connection_unavailable",
    retryable: false,
  });
});

test("returns connection_unavailable for a missing location", async () => {
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([createConnection({ configuration: {} })]),
  );

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.code, "connection_unavailable");
  }
});

test("returns connection_unavailable for multiple normalized locations", async () => {
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([
      createConnection({
        configuration: {
          locationIds: ["location-1", "location-1", "location-2"],
        },
      }),
    ]),
  );

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.code, "connection_unavailable");
  }
});

test("verified location takes precedence over activated and discovered locations", async () => {
  const serviceCalls: Array<{
    connection: CrmConnection;
    locationId: string;
  }> = [];
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies(
      [
        createConnection({
          configuration: {
            verifiedLocationIds: [" verified-location "],
            activatedLocationIds: ["activated-location"],
            locationIds: ["discovered-location"],
          },
        }),
      ],
      createOperations(serviceCalls),
    ),
  );

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  await result.tools.findServices();
  assert.equal(serviceCalls[0]?.locationId, "verified-location");
});

test("activated location takes precedence when verified locations are absent", async () => {
  const serviceCalls: Array<{
    connection: CrmConnection;
    locationId: string;
  }> = [];
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies(
      [
        createConnection({
          configuration: {
            activatedLocationIds: ["activated-location"],
            locationIds: ["discovered-location"],
          },
        }),
      ],
      createOperations(serviceCalls),
    ),
  );

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  await result.tools.findServices();
  assert.equal(serviceCalls[0]?.locationId, "activated-location");
});

test("returns operation_not_supported when the provider has no operations", async () => {
  const dependencies: BookingContextResolverDependencies = {
    loadConnections: async () => [createConnection()],
    getProvider: () => ({}),
  };
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    dependencies,
  );

  assert.deepEqual(result, {
    success: false,
    code: "operation_not_supported",
    retryable: false,
  });
});

test("returns provider_unavailable without exposing a provider resolver error", async () => {
  const dependencies: BookingContextResolverDependencies = {
    loadConnections: async () => [createConnection()],
    getProvider: () => {
      throw new Error("raw provider error with private details");
    },
  };

  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    dependencies,
  );

  assert.deepEqual(result, {
    success: false,
    code: "provider_unavailable",
    retryable: false,
  });
});

test("returns provider_unavailable when provider resolution returns nothing", async () => {
  const dependencies: BookingContextResolverDependencies = {
    loadConnections: async () => [createConnection()],
    getProvider: () => undefined,
  };

  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    dependencies,
  );

  assert.deepEqual(result, {
    success: false,
    code: "provider_unavailable",
    retryable: false,
  });
});

test("success exposes only SafeBookingTools and no trusted execution context", async () => {
  const result = await resolveSafeBookingToolsForOrganizationCore(
    ORGANIZATION_ID,
    createDependencies([createConnection()]),
  );

  assert.equal(result.success, true);
  if (!result.success) {
    return;
  }

  assert.deepEqual(Object.keys(result).sort(), ["success", "tools"]);
  assert.deepEqual(Object.keys(result.tools).sort(), [
    "cancelAppointment",
    "createAppointment",
    "findAvailableSlots",
    "findServices",
    "findStaff",
    "rescheduleAppointment",
  ]);
  assert.equal("connection" in result, false);
  assert.equal("locationId" in result, false);
  assert.equal("operations" in result, false);
  assert.equal("provider" in result, false);
});
