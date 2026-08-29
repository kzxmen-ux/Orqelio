import assert from "node:assert/strict";
import test from "node:test";

import type { BookingProvider } from "./booking-provider";
import type {
  BOOKING_PROVIDER_OPERATION_FAILURE_CODES,
  BookingAppointment,
  BookingProviderOperationResult,
  BookingProviderOperations,
  BookingService,
  BookingSlot,
  BookingStaffMember,
} from "./booking-operations";
import type { CrmConnection } from "../types";

const connection = {
  configuration: {},
  createdAt: "2026-08-29T10:00:00.000Z",
  displayName: "Contract fixture",
  id: "connection-opaque-id",
  lastSyncAt: null,
  organizationId: "organization-opaque-id",
  provider: "custom",
  status: "connected",
  updatedAt: "2026-08-29T10:00:00.000Z",
} satisfies CrmConnection;

const listServicesSuccess = {
  success: true,
  data: [
    {
      id: "service-opaque-id",
      name: "Service",
      durationMinutes: 60,
      priceMinor: 10_000,
      currency: "KZT",
    },
  ],
} satisfies BookingProviderOperationResult<readonly BookingService[]>;

const listStaffSuccess = {
  success: true,
  data: [{ id: "staff-opaque-id", name: "Staff member" }],
} satisfies BookingProviderOperationResult<readonly BookingStaffMember[]>;

const availableSlotsSuccess = {
  success: true,
  data: [
    {
      startAt: "2026-08-30T10:00:00.000Z",
      endAt: "2026-08-30T11:00:00.000Z",
      staffId: "staff-opaque-id",
    },
  ],
} satisfies BookingProviderOperationResult<readonly BookingSlot[]>;

const appointmentSuccess = {
  success: true,
  data: {
    id: "appointment-opaque-id",
    serviceId: "service-opaque-id",
    staffId: "staff-opaque-id",
    startAt: "2026-08-30T10:00:00.000Z",
    endAt: "2026-08-30T11:00:00.000Z",
    status: "confirmed",
  },
} satisfies BookingProviderOperationResult<BookingAppointment>;

const cancellationSuccess = {
  success: true,
  data: {
    appointmentId: "appointment-opaque-id",
    status: "cancelled",
  },
} satisfies BookingProviderOperationResult<{
  appointmentId: string;
  status: "cancelled";
}>;

const safeFailure = {
  success: false,
  code: "provider_unavailable",
  retryable: true,
} satisfies BookingProviderOperationResult<never>;

const expectedFailureCodes = [
  "invalid_request",
  "connection_unavailable",
  "provider_unavailable",
  "not_found",
  "slot_unavailable",
  "operation_not_supported",
  "provider_error",
] as const;

type FailureCodeConstantIsExact =
  typeof BOOKING_PROVIDER_OPERATION_FAILURE_CODES extends typeof expectedFailureCodes
    ? typeof expectedFailureCodes extends typeof BOOKING_PROVIDER_OPERATION_FAILURE_CODES
      ? true
      : false
    : false;

const failureCodeConstantIsExact: FailureCodeConstantIsExact = true;

const operations: BookingProviderOperations = {
  async listServices() {
    return listServicesSuccess;
  },
  async listStaff() {
    return listStaffSuccess;
  },
  async findAvailableSlots() {
    return availableSlotsSuccess;
  },
  async createAppointment() {
    return appointmentSuccess;
  },
  async cancelAppointment() {
    return cancellationSuccess;
  },
  async rescheduleAppointment() {
    return appointmentSuccess;
  },
} satisfies BookingProviderOperations;

const providerWithoutOperations = {
  disconnect() {
    return { status: "disconnected" } as const;
  },
  async getConnectionMetadata() {
    return null;
  },
  testConnection() {
    return { status: "provider_unavailable" } as const;
  },
  validateCredentials() {
    return { data: {}, success: true } as const;
  },
} satisfies BookingProvider;

test("booking operation failure codes are fixed and safe", () => {
  assert.equal(failureCodeConstantIsExact, true);
  assert.deepEqual(expectedFailureCodes, [
    "invalid_request",
    "connection_unavailable",
    "provider_unavailable",
    "not_found",
    "slot_unavailable",
    "operation_not_supported",
    "provider_error",
  ]);
  assert.deepEqual(Object.keys(safeFailure).sort(), [
    "code",
    "retryable",
    "success",
  ]);
});

test("booking operation contracts return normalized provider-neutral data", async () => {
  assert.deepEqual(
    await operations.listServices({ connection, locationId: "location-opaque-id" }),
    listServicesSuccess,
  );
  assert.deepEqual(
    await operations.listStaff({
      connection,
      locationId: "location-opaque-id",
      serviceId: "service-opaque-id",
    }),
    listStaffSuccess,
  );
  assert.deepEqual(
    await operations.findAvailableSlots({
      connection,
      locationId: "location-opaque-id",
      serviceId: "service-opaque-id",
      staffId: "staff-opaque-id",
      from: "2026-08-30T00:00:00.000Z",
      to: "2026-08-31T00:00:00.000Z",
    }),
    availableSlotsSuccess,
  );
  assert.deepEqual(
    await operations.createAppointment({
      connection,
      locationId: "location-opaque-id",
      serviceId: "service-opaque-id",
      staffId: "staff-opaque-id",
      startAt: "2026-08-30T10:00:00.000Z",
      customer: { name: "Customer", phone: "+70000000000" },
    }),
    appointmentSuccess,
  );
  assert.deepEqual(
    await operations.cancelAppointment({
      connection,
      locationId: "location-opaque-id",
      appointmentId: "appointment-opaque-id",
    }),
    cancellationSuccess,
  );
  assert.deepEqual(
    await operations.rescheduleAppointment({
      connection,
      locationId: "location-opaque-id",
      appointmentId: "appointment-opaque-id",
      staffId: "staff-opaque-id",
      startAt: "2026-08-30T12:00:00.000Z",
    }),
    appointmentSuccess,
  );
});

test("BookingProvider remains valid without booking operations", () => {
  assert.equal("operations" in providerWithoutOperations, false);
});
