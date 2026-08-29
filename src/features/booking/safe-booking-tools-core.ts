import type {
  BookingAppointment,
  BookingProviderOperationFailureCode,
  BookingProviderOperationResult,
  BookingProviderOperations,
  BookingService,
  BookingSlot,
  BookingStaffMember,
} from "../crm-connections/providers/booking-operations";
import type { CrmConnection } from "../crm-connections/types";

export type TrustedBookingExecutionContext = {
  connection: CrmConnection;
  locationId: string;
  operations: BookingProviderOperations;
};

export type SafeBookingToolResult<T> = BookingProviderOperationResult<T>;

export type SafeBookingFindStaffInput = {
  serviceId?: string;
};

export type SafeBookingFindAvailableSlotsInput = {
  serviceId: string;
  staffId?: string;
  from: string;
  to: string;
};

export type SafeBookingCreateAppointmentInput = {
  serviceId: string;
  staffId: string;
  startAt: string;
  customer: {
    name: string;
    phone: string;
  };
};

export type SafeBookingCancelAppointmentInput = {
  appointmentId: string;
};

export type SafeBookingRescheduleAppointmentInput = {
  appointmentId: string;
  staffId: string;
  startAt: string;
};

export type SafeBookingCancellation = {
  appointmentId: string;
  status: "cancelled";
};

export interface SafeBookingTools {
  findServices(): Promise<
    SafeBookingToolResult<readonly BookingService[]>
  >;

  findStaff(
    input?: SafeBookingFindStaffInput,
  ): Promise<SafeBookingToolResult<readonly BookingStaffMember[]>>;

  findAvailableSlots(
    input: SafeBookingFindAvailableSlotsInput,
  ): Promise<SafeBookingToolResult<readonly BookingSlot[]>>;

  createAppointment(
    input: SafeBookingCreateAppointmentInput,
  ): Promise<SafeBookingToolResult<BookingAppointment>>;

  cancelAppointment(
    input: SafeBookingCancelAppointmentInput,
  ): Promise<SafeBookingToolResult<SafeBookingCancellation>>;

  rescheduleAppointment(
    input: SafeBookingRescheduleAppointmentInput,
  ): Promise<SafeBookingToolResult<BookingAppointment>>;
}

const NORMALIZED_FAILURE_CODES = Object.freeze({
  invalid_request: true,
  connection_unavailable: true,
  provider_unavailable: true,
  not_found: true,
  slot_unavailable: true,
  operation_not_supported: true,
  provider_error: true,
}) satisfies Readonly<Record<BookingProviderOperationFailureCode, true>>;

type UnknownRecord = Record<string, unknown>;

type SuccessSanitizer<T> = (value: unknown) => T | null;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFailureCode(
  value: unknown,
): value is BookingProviderOperationFailureCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(NORMALIZED_FAILURE_CODES, value)
  );
}

function providerError<T>(): SafeBookingToolResult<T> {
  return {
    success: false,
    code: "provider_error",
    retryable: false,
  };
}

function sanitizeService(value: unknown): BookingService | null {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isFiniteNumber(value.durationMinutes) ||
    !(
      value.priceMinor === null || isFiniteNumber(value.priceMinor)
    ) ||
    !(value.currency === null || isString(value.currency))
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    durationMinutes: value.durationMinutes,
    priceMinor: value.priceMinor,
    currency: value.currency,
  };
}

function sanitizeStaffMember(value: unknown): BookingStaffMember | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) {
    return null;
  }

  return { id: value.id, name: value.name };
}

function sanitizeSlot(value: unknown): BookingSlot | null {
  if (
    !isRecord(value) ||
    !isString(value.startAt) ||
    !isString(value.endAt) ||
    !isString(value.staffId)
  ) {
    return null;
  }

  return {
    startAt: value.startAt,
    endAt: value.endAt,
    staffId: value.staffId,
  };
}

function sanitizeAppointment(value: unknown): BookingAppointment | null {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.serviceId) ||
    !isString(value.staffId) ||
    !isString(value.startAt) ||
    !isString(value.endAt) ||
    value.status !== "confirmed"
  ) {
    return null;
  }

  return {
    id: value.id,
    serviceId: value.serviceId,
    staffId: value.staffId,
    startAt: value.startAt,
    endAt: value.endAt,
    status: "confirmed",
  };
}

function sanitizeCancellation(value: unknown): SafeBookingCancellation | null {
  if (
    !isRecord(value) ||
    !isString(value.appointmentId) ||
    value.status !== "cancelled"
  ) {
    return null;
  }

  return { appointmentId: value.appointmentId, status: "cancelled" };
}

function sanitizeArray<T>(
  value: unknown,
  sanitizeItem: SuccessSanitizer<T>,
): readonly T[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const sanitized: T[] = [];
  for (const item of value) {
    const sanitizedItem = sanitizeItem(item);
    if (sanitizedItem === null) {
      return null;
    }
    sanitized.push(sanitizedItem);
  }

  return sanitized;
}

function sanitizeProviderResult<T>(
  value: unknown,
  sanitizeSuccess: SuccessSanitizer<T>,
): SafeBookingToolResult<T> {
  if (!isRecord(value)) {
    return providerError();
  }

  if (value.success === false) {
    if (!isFailureCode(value.code) || typeof value.retryable !== "boolean") {
      return providerError();
    }

    return {
      success: false,
      code: value.code,
      retryable: value.retryable,
    };
  }

  if (value.success !== true) {
    return providerError();
  }

  const data = sanitizeSuccess(value.data);
  return data === null ? providerError() : { success: true, data };
}

async function invokeProviderOperation<T>(
  operation: () => Promise<unknown>,
  sanitizeSuccess: SuccessSanitizer<T>,
): Promise<SafeBookingToolResult<T>> {
  try {
    const result = await operation();
    return sanitizeProviderResult(result, sanitizeSuccess);
  } catch {
    // A thrown mutation may have reached the provider, so this layer never retries.
    return providerError();
  }
}

export function createSafeBookingTools(
  context: TrustedBookingExecutionContext,
): SafeBookingTools {
  const { connection, locationId, operations } = context;

  return Object.freeze<SafeBookingTools>({
    findServices: async () =>
      invokeProviderOperation(
        () => operations.listServices({ connection, locationId }),
        (value) => sanitizeArray(value, sanitizeService),
      ),

    findStaff: async (input = {}) =>
      invokeProviderOperation(
        () =>
          operations.listStaff(
            input.serviceId === undefined
              ? { connection, locationId }
              : { connection, locationId, serviceId: input.serviceId },
          ),
        (value) => sanitizeArray(value, sanitizeStaffMember),
      ),

    findAvailableSlots: async (input) =>
      invokeProviderOperation(
        () =>
          operations.findAvailableSlots(
            input.staffId === undefined
              ? {
                  connection,
                  locationId,
                  serviceId: input.serviceId,
                  from: input.from,
                  to: input.to,
                }
              : {
                  connection,
                  locationId,
                  serviceId: input.serviceId,
                  staffId: input.staffId,
                  from: input.from,
                  to: input.to,
                },
          ),
        (value) => sanitizeArray(value, sanitizeSlot),
      ),

    createAppointment: async (input) =>
      invokeProviderOperation(
        () =>
          operations.createAppointment({
            connection,
            locationId,
            serviceId: input.serviceId,
            staffId: input.staffId,
            startAt: input.startAt,
            customer: {
              name: input.customer.name,
              phone: input.customer.phone,
            },
          }),
        sanitizeAppointment,
      ),

    cancelAppointment: async (input) =>
      invokeProviderOperation(
        () =>
          operations.cancelAppointment({
            connection,
            locationId,
            appointmentId: input.appointmentId,
          }),
        sanitizeCancellation,
      ),

    rescheduleAppointment: async (input) =>
      invokeProviderOperation(
        () =>
          operations.rescheduleAppointment({
            connection,
            locationId,
            appointmentId: input.appointmentId,
            staffId: input.staffId,
            startAt: input.startAt,
          }),
        sanitizeAppointment,
      ),
  });
}
