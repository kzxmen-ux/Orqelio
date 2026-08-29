import "server-only";

import type { CrmConnection } from "../types";

export const BOOKING_PROVIDER_OPERATION_FAILURE_CODES = [
  "invalid_request",
  "connection_unavailable",
  "provider_unavailable",
  "not_found",
  "slot_unavailable",
  "operation_not_supported",
  "provider_error",
] as const;

export type BookingProviderOperationFailureCode =
  (typeof BOOKING_PROVIDER_OPERATION_FAILURE_CODES)[number];

export type BookingService = {
  id: string;
  name: string;
  durationMinutes: number;
  priceMinor: number | null;
  currency: string | null;
};

export type BookingStaffMember = {
  id: string;
  name: string;
};

export type BookingSlot = {
  startAt: string;
  endAt: string;
  staffId: string;
};

export type BookingAppointment = {
  id: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  endAt: string;
  status: "confirmed";
};

export type BookingProviderOperationResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      code: BookingProviderOperationFailureCode;
      retryable: boolean;
    };

export type ListServicesInput = {
  connection: CrmConnection;
  locationId: string;
};

export type ListStaffInput = {
  connection: CrmConnection;
  locationId: string;
  serviceId?: string;
};

export type FindAvailableSlotsInput = {
  connection: CrmConnection;
  locationId: string;
  serviceId: string;
  staffId?: string;
  from: string;
  to: string;
};

export type CreateAppointmentInput = {
  connection: CrmConnection;
  locationId: string;
  serviceId: string;
  staffId: string;
  startAt: string;
  customer: {
    name: string;
    phone: string;
  };
};

export type CancelAppointmentInput = {
  connection: CrmConnection;
  locationId: string;
  appointmentId: string;
};

export type RescheduleAppointmentInput = {
  connection: CrmConnection;
  locationId: string;
  appointmentId: string;
  staffId: string;
  startAt: string;
};

export interface BookingProviderOperations {
  listServices(
    input: ListServicesInput,
  ): Promise<BookingProviderOperationResult<readonly BookingService[]>>;

  listStaff(
    input: ListStaffInput,
  ): Promise<BookingProviderOperationResult<readonly BookingStaffMember[]>>;

  findAvailableSlots(
    input: FindAvailableSlotsInput,
  ): Promise<BookingProviderOperationResult<readonly BookingSlot[]>>;

  // Mutation success means the provider verified the requested booking change.
  // Callers must never infer success merely because AI requested the operation.
  createAppointment(
    input: CreateAppointmentInput,
  ): Promise<BookingProviderOperationResult<BookingAppointment>>;

  cancelAppointment(
    input: CancelAppointmentInput,
  ): Promise<
    BookingProviderOperationResult<{
      appointmentId: string;
      status: "cancelled";
    }>
  >;

  rescheduleAppointment(
    input: RescheduleAppointmentInput,
  ): Promise<BookingProviderOperationResult<BookingAppointment>>;
}
