import assert from "node:assert/strict";
import test from "node:test";

import type {
  BookingProviderOperationFailureCode,
  BookingProviderOperationResult,
  BookingProviderOperations,
} from "../booking-operations";
import type { CrmConnection } from "../../types";
import { developmentBookingOperations } from "./development-booking-operations-core.ts";
import type { DevelopmentProvider } from "./development-provider";

const connectedDevelopmentConnection = {
  configuration: {},
  createdAt: "2026-08-29T00:00:00.000Z",
  displayName: "Development",
  id: "development-connection",
  lastSyncAt: null,
  organizationId: "organization-id",
  provider: "custom",
  status: "connected",
  updatedAt: "2026-08-29T00:00:00.000Z",
} satisfies CrmConnection;

const locationId = "dev-location-1";
const operations: BookingProviderOperations = developmentBookingOperations;

type DevelopmentProviderExposesOperations =
  DevelopmentProvider["operations"] extends BookingProviderOperations
    ? true
    : false;

const developmentProviderExposesOperations: DevelopmentProviderExposesOperations =
  true;

function expectFailure<T>(
  result: BookingProviderOperationResult<T>,
  code: BookingProviderOperationFailureCode,
): void {
  assert.deepEqual(result, { success: false, code, retryable: false });
}

async function createFixtureAppointment(customer = {
  name: "Тестовый клиент",
  phone: "+77001234567",
}) {
  return operations.createAppointment({
    connection: connectedDevelopmentConnection,
    locationId,
    serviceId: "dev-service-haircut",
    staffId: "dev-staff-1",
    startAt: "2026-08-30T09:00:00.000Z",
    customer,
  });
}

test("DevelopmentProvider exposes deterministic booking operations", () => {
  assert.equal(developmentProviderExposesOperations, true);
  assert.equal(Object.isFrozen(developmentBookingOperations), true);
});

test("lists fresh normalized service fixtures", async () => {
  const first = await operations.listServices({
    connection: connectedDevelopmentConnection,
    locationId,
  });
  const second = await operations.listServices({
    connection: connectedDevelopmentConnection,
    locationId,
  });

  assert.deepEqual(first, {
    success: true,
    data: [
      {
        id: "dev-service-haircut",
        name: "Стрижка",
        durationMinutes: 60,
        priceMinor: 12_000,
        currency: "KZT",
      },
      {
        id: "dev-service-beard",
        name: "Оформление бороды",
        durationMinutes: 30,
        priceMinor: 7_000,
        currency: "KZT",
      },
    ],
  });
  assert.deepEqual(second, first);
  if (first.success && second.success) {
    assert.notEqual(first.data, second.data);
    assert.notEqual(first.data[0], second.data[0]);
  }
});

test("filters staff by supported service", async () => {
  const allStaff = await operations.listStaff({
    connection: connectedDevelopmentConnection,
    locationId,
  });
  const haircutStaff = await operations.listStaff({
    connection: connectedDevelopmentConnection,
    locationId,
    serviceId: "dev-service-haircut",
  });
  const beardStaff = await operations.listStaff({
    connection: connectedDevelopmentConnection,
    locationId,
    serviceId: "dev-service-beard",
  });

  const bothStaff = [
    { id: "dev-staff-1", name: "Алексей" },
    { id: "dev-staff-2", name: "Данияр" },
  ];
  assert.deepEqual(allStaff, { success: true, data: bothStaff });
  assert.deepEqual(haircutStaff, { success: true, data: bothStaff });
  assert.deepEqual(beardStaff, {
    success: true,
    data: [{ id: "dev-staff-1", name: "Алексей" }],
  });
});

test("generates deterministic ordered UTC slots inside the complete interval", async () => {
  const input = {
    connection: connectedDevelopmentConnection,
    locationId,
    serviceId: "dev-service-haircut",
    from: "2026-08-30T08:30:00.000Z",
    to: "2026-08-30T17:00:00.000Z",
  };

  const first = await operations.findAvailableSlots(input);
  const second = await operations.findAvailableSlots(input);
  assert.deepEqual(second, first);
  assert.equal(first.success, true);
  if (!first.success) {
    return;
  }

  assert.equal(first.data.length, 8);
  assert.deepEqual(first.data.slice(0, 4), [
    {
      startAt: "2026-08-30T09:00:00.000Z",
      endAt: "2026-08-30T10:00:00.000Z",
      staffId: "dev-staff-1",
    },
    {
      startAt: "2026-08-30T09:00:00.000Z",
      endAt: "2026-08-30T10:00:00.000Z",
      staffId: "dev-staff-2",
    },
    {
      startAt: "2026-08-30T11:00:00.000Z",
      endAt: "2026-08-30T12:00:00.000Z",
      staffId: "dev-staff-1",
    },
    {
      startAt: "2026-08-30T11:00:00.000Z",
      endAt: "2026-08-30T12:00:00.000Z",
      staffId: "dev-staff-2",
    },
  ]);
  assert.deepEqual(first.data.at(-1), {
    startAt: "2026-08-30T16:00:00.000Z",
    endAt: "2026-08-30T17:00:00.000Z",
    staffId: "dev-staff-2",
  });
});

test("rejects invalid connections and locations safely", async () => {
  const wrongProvider = {
    ...connectedDevelopmentConnection,
    provider: "altegio",
  } satisfies CrmConnection;
  const disconnected = {
    ...connectedDevelopmentConnection,
    status: "disconnected",
  } satisfies CrmConnection;

  expectFailure(
    await operations.listServices({ connection: wrongProvider, locationId }),
    "connection_unavailable",
  );
  expectFailure(
    await operations.listServices({ connection: disconnected, locationId }),
    "connection_unavailable",
  );
  expectFailure(
    await operations.listServices({
      connection: connectedDevelopmentConnection,
      locationId: "unknown-location",
    }),
    "not_found",
  );
});

test("rejects invalid ranges and unknown or unsupported entities safely", async () => {
  expectFailure(
    await operations.findAvailableSlots({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-haircut",
      from: "invalid",
      to: "2026-08-30T17:00:00.000Z",
    }),
    "invalid_request",
  );
  expectFailure(
    await operations.findAvailableSlots({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-haircut",
      from: "2026-08-30T17:00:00.000Z",
      to: "2026-08-30T17:00:00.000Z",
    }),
    "invalid_request",
  );
  expectFailure(
    await operations.listStaff({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "unknown-service",
    }),
    "not_found",
  );
  expectFailure(
    await operations.findAvailableSlots({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-haircut",
      staffId: "unknown-staff",
      from: "2026-08-30T08:00:00.000Z",
      to: "2026-08-30T17:00:00.000Z",
    }),
    "not_found",
  );
  expectFailure(
    await operations.findAvailableSlots({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-beard",
      staffId: "dev-staff-2",
      from: "2026-08-30T08:00:00.000Z",
      to: "2026-08-30T17:00:00.000Z",
    }),
    "invalid_request",
  );
});

test("creates a confirmed appointment with a deterministic non-sensitive id", async () => {
  const customer = { name: "Тестовый клиент", phone: "+77001234567" };
  const first = await createFixtureAppointment(customer);
  const second = await createFixtureAppointment(customer);

  assert.equal(first.success, true);
  assert.deepEqual(second, first);
  if (!first.success) {
    return;
  }

  assert.deepEqual(first.data, {
    id: first.data.id,
    serviceId: "dev-service-haircut",
    staffId: "dev-staff-1",
    startAt: "2026-08-30T09:00:00.000Z",
    endAt: "2026-08-30T10:00:00.000Z",
    status: "confirmed",
  });
  assert.match(
    first.data.id,
    /^dev-appointment-v1:dev-service-haircut:dev-staff-1:-?\d+$/,
  );
  assert.equal(first.data.id.includes(customer.name), false);
  assert.equal(first.data.id.includes(customer.phone), false);
  assert.equal(
    first.data.id.includes(connectedDevelopmentConnection.organizationId),
    false,
  );
});

test("rejects invalid appointment creation without throwing", async () => {
  expectFailure(
    await operations.createAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-beard",
      staffId: "dev-staff-2",
      startAt: "2026-08-30T09:00:00.000Z",
      customer: { name: "Customer", phone: "+77001234567" },
    }),
    "invalid_request",
  );
  expectFailure(
    await operations.createAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-haircut",
      staffId: "dev-staff-1",
      startAt: "2026-08-30T10:00:00.000Z",
      customer: { name: "Customer", phone: "+77001234567" },
    }),
    "slot_unavailable",
  );
  expectFailure(
    await operations.createAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      serviceId: "dev-service-haircut",
      staffId: "dev-staff-1",
      startAt: "2026-08-30T09:00:00.000Z",
      customer: { name: "  ", phone: "+77001234567" },
    }),
    "invalid_request",
  );
});

test("cancels only valid deterministic development appointment ids", async () => {
  const created = await createFixtureAppointment();
  assert.equal(created.success, true);
  if (!created.success) {
    return;
  }

  assert.deepEqual(
    await operations.cancelAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      appointmentId: created.data.id,
    }),
    {
      success: true,
      data: { appointmentId: created.data.id, status: "cancelled" },
    },
  );
  expectFailure(
    await operations.cancelAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      appointmentId: "unknown-appointment",
    }),
    "not_found",
  );
});

test("reschedules statelessly using the service encoded in the appointment id", async () => {
  const created = await createFixtureAppointment();
  assert.equal(created.success, true);
  if (!created.success) {
    return;
  }

  const rescheduled = await operations.rescheduleAppointment({
    connection: connectedDevelopmentConnection,
    locationId,
    appointmentId: created.data.id,
    staffId: "dev-staff-2",
    startAt: "2026-08-31T14:00:00.000Z",
  });
  assert.deepEqual(rescheduled, {
    success: true,
    data: {
      id: created.data.id,
      serviceId: "dev-service-haircut",
      staffId: "dev-staff-2",
      startAt: "2026-08-31T14:00:00.000Z",
      endAt: "2026-08-31T15:00:00.000Z",
      status: "confirmed",
    },
  });

  expectFailure(
    await operations.rescheduleAppointment({
      connection: connectedDevelopmentConnection,
      locationId,
      appointmentId: created.data.id,
      staffId: "dev-staff-2",
      startAt: "2026-08-31T15:00:00.000Z",
    }),
    "slot_unavailable",
  );
});

test("operations run without network, database, or mutable appointment state", async () => {
  const first = await createFixtureAppointment();
  const second = await createFixtureAppointment();
  assert.deepEqual(second, first);
});
