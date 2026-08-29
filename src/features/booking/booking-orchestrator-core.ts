import type {
  SafeBookingToolResult,
  SafeBookingTools,
} from "./safe-booking-tools-core";

export type BookingOrchestratorInput =
  | {
      intent: "check_availability";
      serviceId?: string;
      staffId?: string;
      from?: string;
      to?: string;
    }
  | {
      intent: "create_appointment";
      serviceId?: string;
      staffId?: string;
      startAt?: string;
      customer?: {
        name?: string;
        phone?: string;
      };
    }
  | {
      intent: "cancel_appointment";
      appointmentId?: string;
    }
  | {
      intent: "reschedule_appointment";
      appointmentId?: string;
      staffId?: string;
      startAt?: string;
    };

export type BookingOrchestratorMissingField =
  | "serviceId"
  | "staffId"
  | "from"
  | "to"
  | "startAt"
  | "customer.name"
  | "customer.phone"
  | "appointmentId";

type ExecutedResult =
  | {
      status: "executed";
      intent: "check_availability";
      result: Awaited<ReturnType<SafeBookingTools["findAvailableSlots"]>>;
    }
  | {
      status: "executed";
      intent: "create_appointment";
      result: Awaited<ReturnType<SafeBookingTools["createAppointment"]>>;
    }
  | {
      status: "executed";
      intent: "cancel_appointment";
      result: Awaited<ReturnType<SafeBookingTools["cancelAppointment"]>>;
    }
  | {
      status: "executed";
      intent: "reschedule_appointment";
      result: Awaited<ReturnType<SafeBookingTools["rescheduleAppointment"]>>;
    };

export type BookingOrchestratorResult =
  | {
      status: "needs_input";
      missingFields: readonly BookingOrchestratorMissingField[];
    }
  | ExecutedResult;

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function providerError<T>(): SafeBookingToolResult<T> {
  return {
    success: false,
    code: "provider_error",
    retryable: false,
  };
}

async function invokeTool<T>(
  operation: () => Promise<SafeBookingToolResult<T>>,
): Promise<SafeBookingToolResult<T>> {
  try {
    return await operation();
  } catch {
    return providerError();
  }
}

function needsInput(
  missingFields: readonly BookingOrchestratorMissingField[],
): BookingOrchestratorResult {
  return { status: "needs_input", missingFields };
}

export async function executeBookingOrchestrator(
  input: BookingOrchestratorInput,
  tools: SafeBookingTools,
): Promise<BookingOrchestratorResult> {
  switch (input.intent) {
    case "check_availability": {
      const serviceId = normalizeString(input.serviceId);
      const from = normalizeString(input.from);
      const to = normalizeString(input.to);
      const staffId = normalizeString(input.staffId);
      const missingFields: BookingOrchestratorMissingField[] = [];

      if (serviceId === null) missingFields.push("serviceId");
      if (from === null) missingFields.push("from");
      if (to === null) missingFields.push("to");

      if (serviceId === null || from === null || to === null) {
        return needsInput(missingFields);
      }

      const result = await invokeTool(() =>
        tools.findAvailableSlots(
          staffId === null
            ? { serviceId, from, to }
            : { serviceId, staffId, from, to },
        ),
      );

      return { status: "executed", intent: input.intent, result };
    }

    case "create_appointment": {
      const serviceId = normalizeString(input.serviceId);
      const staffId = normalizeString(input.staffId);
      const startAt = normalizeString(input.startAt);
      const customerName = normalizeString(input.customer?.name);
      const customerPhone = normalizeString(input.customer?.phone);
      const missingFields: BookingOrchestratorMissingField[] = [];

      if (serviceId === null) missingFields.push("serviceId");
      if (staffId === null) missingFields.push("staffId");
      if (startAt === null) missingFields.push("startAt");
      if (customerName === null) missingFields.push("customer.name");
      if (customerPhone === null) missingFields.push("customer.phone");

      if (
        serviceId === null ||
        staffId === null ||
        startAt === null ||
        customerName === null ||
        customerPhone === null
      ) {
        return needsInput(missingFields);
      }

      const result = await invokeTool(() =>
        tools.createAppointment({
          serviceId,
          staffId,
          startAt,
          customer: { name: customerName, phone: customerPhone },
        }),
      );

      return { status: "executed", intent: input.intent, result };
    }

    case "cancel_appointment": {
      const appointmentId = normalizeString(input.appointmentId);

      if (appointmentId === null) {
        return needsInput(["appointmentId"]);
      }

      const result = await invokeTool(() =>
        tools.cancelAppointment({ appointmentId }),
      );

      return { status: "executed", intent: input.intent, result };
    }

    case "reschedule_appointment": {
      const appointmentId = normalizeString(input.appointmentId);
      const staffId = normalizeString(input.staffId);
      const startAt = normalizeString(input.startAt);
      const missingFields: BookingOrchestratorMissingField[] = [];

      if (appointmentId === null) missingFields.push("appointmentId");
      if (staffId === null) missingFields.push("staffId");
      if (startAt === null) missingFields.push("startAt");

      if (
        appointmentId === null ||
        staffId === null ||
        startAt === null
      ) {
        return needsInput(missingFields);
      }

      const result = await invokeTool(() =>
        tools.rescheduleAppointment({ appointmentId, staffId, startAt }),
      );

      return { status: "executed", intent: input.intent, result };
    }
  }
}
