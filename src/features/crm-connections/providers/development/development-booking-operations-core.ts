import type {
  BookingAppointment,
  BookingProviderOperationFailureCode,
  BookingProviderOperationResult,
  BookingProviderOperations,
  BookingService,
  BookingSlot,
  BookingStaffMember,
} from "../booking-operations";
import type { CrmConnection } from "../../types";

const DEVELOPMENT_LOCATION_ID = "dev-location-1";
const APPOINTMENT_ID_PREFIX = "dev-appointment-v1";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SLOT_START_HOURS_UTC = [9, 11, 14, 16] as const;

const DEVELOPMENT_SERVICES = Object.freeze([
  Object.freeze({
    id: "dev-service-haircut",
    name: "Стрижка",
    durationMinutes: 60,
    priceMinor: 12_000,
    currency: "KZT",
  }),
  Object.freeze({
    id: "dev-service-beard",
    name: "Оформление бороды",
    durationMinutes: 30,
    priceMinor: 7_000,
    currency: "KZT",
  }),
]) satisfies readonly BookingService[];

type DevelopmentStaffFixture = BookingStaffMember & {
  supportedServiceIds: readonly string[];
};

const DEVELOPMENT_STAFF = Object.freeze([
  Object.freeze({
    id: "dev-staff-1",
    name: "Алексей",
    supportedServiceIds: Object.freeze([
      "dev-service-haircut",
      "dev-service-beard",
    ]),
  }),
  Object.freeze({
    id: "dev-staff-2",
    name: "Данияр",
    supportedServiceIds: Object.freeze(["dev-service-haircut"]),
  }),
]) satisfies readonly DevelopmentStaffFixture[];

type OperationFailure = Extract<
  BookingProviderOperationResult<never>,
  { success: false }
>;

type DecodedDevelopmentAppointment = {
  service: BookingService;
  staff: DevelopmentStaffFixture;
  startMilliseconds: number;
};

function failure(code: BookingProviderOperationFailureCode): OperationFailure {
  return { success: false, code, retryable: false };
}

function validateConnectionAndLocation(
  connection: CrmConnection,
  locationId: string,
): OperationFailure | null {
  if (connection.provider !== "custom" || connection.status !== "connected") {
    return failure("connection_unavailable");
  }

  if (locationId !== DEVELOPMENT_LOCATION_ID) {
    return failure("not_found");
  }

  return null;
}

function findService(serviceId: string): BookingService | null {
  return (
    DEVELOPMENT_SERVICES.find((service) => service.id === serviceId) ?? null
  );
}

function findStaff(staffId: string): DevelopmentStaffFixture | null {
  return DEVELOPMENT_STAFF.find((staff) => staff.id === staffId) ?? null;
}

function supportsService(
  staff: DevelopmentStaffFixture,
  serviceId: string,
): boolean {
  return staff.supportedServiceIds.includes(serviceId);
}

function normalizeTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isAvailableStart(startMilliseconds: number): boolean {
  const start = new Date(startMilliseconds);
  const startHour = start.getUTCHours();

  return (
    SLOT_START_HOURS_UTC.some((allowedHour) => allowedHour === startHour) &&
    start.getUTCMinutes() === 0 &&
    start.getUTCSeconds() === 0 &&
    start.getUTCMilliseconds() === 0
  );
}

function toStaffMember(staff: DevelopmentStaffFixture): BookingStaffMember {
  return { id: staff.id, name: staff.name };
}

function toService(service: BookingService): BookingService {
  return {
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency,
  };
}

function buildAppointmentId(
  serviceId: string,
  staffId: string,
  startMilliseconds: number,
): string {
  return `${APPOINTMENT_ID_PREFIX}:${serviceId}:${staffId}:${startMilliseconds}`;
}

function buildAppointment(
  id: string,
  service: BookingService,
  staffId: string,
  startMilliseconds: number,
): BookingAppointment {
  return {
    id,
    serviceId: service.id,
    staffId,
    startAt: new Date(startMilliseconds).toISOString(),
    endAt: new Date(
      startMilliseconds + service.durationMinutes * 60 * 1_000,
    ).toISOString(),
    status: "confirmed",
  };
}

function decodeAppointmentId(
  appointmentId: string,
): DecodedDevelopmentAppointment | null {
  const parts = appointmentId.split(":");

  if (parts.length !== 4 || parts[0] !== APPOINTMENT_ID_PREFIX) {
    return null;
  }

  const [, serviceId, staffId, startToken] = parts;
  if (!serviceId || !staffId || !startToken) {
    return null;
  }

  if (!/^(?:0|-?[1-9]\d*)$/.test(startToken)) {
    return null;
  }

  const startMilliseconds = Number(startToken);
  if (!Number.isSafeInteger(startMilliseconds)) {
    return null;
  }

  const service = findService(serviceId);
  const staff = findStaff(staffId);
  if (
    !service ||
    !staff ||
    !supportsService(staff, service.id) ||
    !isAvailableStart(startMilliseconds) ||
    buildAppointmentId(service.id, staff.id, startMilliseconds) !== appointmentId
  ) {
    return null;
  }

  return { service, staff, startMilliseconds };
}

function generateAvailableSlots(
  service: BookingService,
  staff: readonly DevelopmentStaffFixture[],
  fromMilliseconds: number,
  toMilliseconds: number,
): readonly BookingSlot[] {
  const firstDay = new Date(fromMilliseconds);
  firstDay.setUTCHours(0, 0, 0, 0);

  const slots: Array<BookingSlot & { startMilliseconds: number }> = [];

  for (
    let dayMilliseconds = firstDay.getTime();
    dayMilliseconds <= toMilliseconds;
    dayMilliseconds += DAY_IN_MILLISECONDS
  ) {
    for (const startHour of SLOT_START_HOURS_UTC) {
      const startMilliseconds =
        dayMilliseconds + startHour * 60 * 60 * 1_000;
      const endMilliseconds =
        startMilliseconds + service.durationMinutes * 60 * 1_000;

      if (
        startMilliseconds < fromMilliseconds ||
        endMilliseconds > toMilliseconds
      ) {
        continue;
      }

      for (const staffMember of staff) {
        slots.push({
          startAt: new Date(startMilliseconds).toISOString(),
          endAt: new Date(endMilliseconds).toISOString(),
          staffId: staffMember.id,
          startMilliseconds,
        });
      }
    }
  }

  slots.sort(
    (left, right) =>
      left.startMilliseconds - right.startMilliseconds ||
      left.staffId.localeCompare(right.staffId),
  );

  return slots.map((slot) => ({
    startAt: slot.startAt,
    endAt: slot.endAt,
    staffId: slot.staffId,
  }));
}

// Controlled development-only simulation: success is test-provider verification,
// never evidence that an operation occurred in a real CRM.
export const developmentBookingOperations: BookingProviderOperations =
  Object.freeze<BookingProviderOperations>({
    async listServices(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      return {
        success: true,
        data: DEVELOPMENT_SERVICES.map(toService),
      };
    },

    async listStaff(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      if (input.serviceId === undefined) {
        return { success: true, data: DEVELOPMENT_STAFF.map(toStaffMember) };
      }

      const service = findService(input.serviceId);
      if (!service) {
        return failure("not_found");
      }

      return {
        success: true,
        data: DEVELOPMENT_STAFF.filter((staff) =>
          supportsService(staff, service.id),
        ).map(toStaffMember),
      };
    },

    async findAvailableSlots(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      const service = findService(input.serviceId);
      if (!service) {
        return failure("not_found");
      }

      const selectedStaff =
        input.staffId === undefined ? null : findStaff(input.staffId);
      if (input.staffId !== undefined && !selectedStaff) {
        return failure("not_found");
      }
      if (selectedStaff && !supportsService(selectedStaff, service.id)) {
        return failure("invalid_request");
      }

      const fromMilliseconds = normalizeTimestamp(input.from);
      const toMilliseconds = normalizeTimestamp(input.to);
      if (
        fromMilliseconds === null ||
        toMilliseconds === null ||
        fromMilliseconds >= toMilliseconds
      ) {
        return failure("invalid_request");
      }

      const eligibleStaff = selectedStaff
        ? [selectedStaff]
        : DEVELOPMENT_STAFF.filter((staff) =>
            supportsService(staff, service.id),
          );

      return {
        success: true,
        data: generateAvailableSlots(
          service,
          eligibleStaff,
          fromMilliseconds,
          toMilliseconds,
        ),
      };
    },

    async createAppointment(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      const service = findService(input.serviceId);
      if (!service) {
        return failure("not_found");
      }

      const staff = findStaff(input.staffId);
      if (!staff) {
        return failure("not_found");
      }
      if (!supportsService(staff, service.id)) {
        return failure("invalid_request");
      }

      const startMilliseconds = normalizeTimestamp(input.startAt);
      if (
        startMilliseconds === null ||
        input.customer.name.trim().length === 0 ||
        input.customer.phone.trim().length === 0
      ) {
        return failure("invalid_request");
      }
      if (!isAvailableStart(startMilliseconds)) {
        return failure("slot_unavailable");
      }

      const appointmentId = buildAppointmentId(
        service.id,
        staff.id,
        startMilliseconds,
      );

      return {
        success: true,
        data: buildAppointment(
          appointmentId,
          service,
          staff.id,
          startMilliseconds,
        ),
      };
    },

    async cancelAppointment(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      if (!decodeAppointmentId(input.appointmentId)) {
        return failure("not_found");
      }

      return {
        success: true,
        data: { appointmentId: input.appointmentId, status: "cancelled" },
      };
    },

    async rescheduleAppointment(input) {
      const contextFailure = validateConnectionAndLocation(
        input.connection,
        input.locationId,
      );
      if (contextFailure) {
        return contextFailure;
      }

      const decodedAppointment = decodeAppointmentId(input.appointmentId);
      if (!decodedAppointment) {
        return failure("not_found");
      }

      const staff = findStaff(input.staffId);
      if (!staff) {
        return failure("not_found");
      }
      if (!supportsService(staff, decodedAppointment.service.id)) {
        return failure("invalid_request");
      }

      const startMilliseconds = normalizeTimestamp(input.startAt);
      if (startMilliseconds === null) {
        return failure("invalid_request");
      }
      if (!isAvailableStart(startMilliseconds)) {
        return failure("slot_unavailable");
      }

      return {
        success: true,
        data: buildAppointment(
          input.appointmentId,
          decodedAppointment.service,
          staff.id,
          startMilliseconds,
        ),
      };
    },
  });
