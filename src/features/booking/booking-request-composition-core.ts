import type { ModelBookingRequest } from "../ai-runtime/decision-types.ts";
import type { BookingProviderOperationFailureCode } from "../crm-connections/providers/booking-operations.ts";
import type {
  BookingCatalogResolutionInput,
  BookingCatalogResolutionResult,
} from "./booking-catalog-resolution-core.ts";
import type { BookingContextResolutionResult } from "./booking-context-resolver-core.ts";
import type { BookingCustomerContextResult } from "./booking-customer-context-core.ts";
import type { BookingOrchestratorInput } from "./booking-orchestrator-core.ts";
import type {
  BookingTemporalResolutionInput,
  BookingTemporalResolutionResult,
} from "./booking-temporal-resolution-core.ts";
import type { BookingTimeContextResult } from "./booking-time-context-core.ts";
import type { SafeBookingTools } from "./safe-booking-tools-core.ts";

export type BookingRequestCompositionInput = {
  organizationId: string;
  conversationId: string;
  bookingIntent:
    | "check_availability"
    | "create_appointment"
    | "reschedule_appointment"
    | "cancel_appointment";
  bookingRequest: ModelBookingRequest;
  nowInstant: string;
};

export type BookingRequestCompositionField =
  | "serviceQuery"
  | "staffQuery"
  | "dateText"
  | "timeText"
  | "customerName";

export type BookingRequestCompositionResult =
  | {
      status: "ready";
      request: BookingOrchestratorInput;
    }
  | {
      status: "needs_input" | "needs_clarification";
      field: BookingRequestCompositionField;
      options?: readonly string[];
    }
  | {
      status: "unavailable";
      code:
        | BookingProviderOperationFailureCode
        | "time_context_unavailable"
        | "customer_context_unavailable";
      retryable: boolean;
    };

export type BookingRequestCompositionDependencies = {
  resolveSafeBookingToolsForOrganization(
    organizationId: string,
  ): Promise<BookingContextResolutionResult>;
  resolveBookingCatalog(
    input: BookingCatalogResolutionInput,
    tools: SafeBookingTools,
  ): Promise<BookingCatalogResolutionResult>;
  loadBookingTimeContextForOrganization(
    organizationId: string,
  ): Promise<BookingTimeContextResult>;
  resolveBookingTemporal(
    input: BookingTemporalResolutionInput,
  ): BookingTemporalResolutionResult;
  loadBookingCustomerContext(
    organizationId: string,
    conversationId: string,
  ): Promise<BookingCustomerContextResult>;
};

function unavailable(
  code: Extract<BookingRequestCompositionResult, { status: "unavailable" }>["code"],
  retryable: boolean,
): BookingRequestCompositionResult {
  return { status: "unavailable", code, retryable };
}

function providerError(): BookingRequestCompositionResult {
  return unavailable("provider_error", false);
}

function normalizeName(value: string | null): string | null {
  if (value === null) return null;

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function unresolvedTemporal(
  result: Extract<
    BookingTemporalResolutionResult,
    { status: "needs_input" | "needs_clarification" }
  >,
): BookingRequestCompositionResult {
  return { status: result.status, field: result.field };
}

function unresolvedCatalog(
  result: Extract<
    BookingCatalogResolutionResult,
    { status: "needs_input" | "needs_clarification" }
  >,
): BookingRequestCompositionResult {
  return result.status === "needs_clarification"
    ? {
        status: "needs_clarification",
        field: result.field,
        options: result.options,
      }
    : { status: "needs_input", field: result.field };
}

export async function composeBookingRequestForOrganizationCore(
  input: BookingRequestCompositionInput,
  dependencies: BookingRequestCompositionDependencies,
): Promise<BookingRequestCompositionResult> {
  if (
    input.bookingIntent === "cancel_appointment" ||
    input.bookingIntent === "reschedule_appointment"
  ) {
    return unavailable("operation_not_supported", false);
  }

  try {
    const timeContext =
      await dependencies.loadBookingTimeContextForOrganization(
        input.organizationId,
      );
    if (!timeContext.success) {
      return unavailable(timeContext.code, false);
    }

    const temporal = dependencies.resolveBookingTemporal({
      intent: input.bookingIntent,
      bookingRequest: input.bookingRequest,
      timeContext: timeContext.context,
      nowInstant: input.nowInstant,
    });
    if (temporal.status === "needs_input" || temporal.status === "needs_clarification") {
      return unresolvedTemporal(temporal);
    }
    if (temporal.status === "failed") {
      return unavailable(temporal.code, false);
    }
    if (temporal.intent !== input.bookingIntent) {
      return providerError();
    }

    const toolsResolution =
      await dependencies.resolveSafeBookingToolsForOrganization(
        input.organizationId,
      );
    if (!toolsResolution.success) {
      return unavailable(
        toolsResolution.code,
        toolsResolution.retryable,
      );
    }

    const catalog = await dependencies.resolveBookingCatalog(
      {
        intent: input.bookingIntent,
        bookingRequest: input.bookingRequest,
      },
      toolsResolution.tools,
    );
    if (catalog.status === "needs_input" || catalog.status === "needs_clarification") {
      return unresolvedCatalog(catalog);
    }
    if (catalog.status === "failed") {
      return unavailable(catalog.code, catalog.retryable);
    }

    if (
      input.bookingIntent === "check_availability" &&
      temporal.intent === "check_availability"
    ) {
      const request: BookingOrchestratorInput =
        catalog.staffId === null
          ? {
              intent: "check_availability",
              serviceId: catalog.serviceId,
              from: temporal.from,
              to: temporal.to,
            }
          : {
              intent: "check_availability",
              serviceId: catalog.serviceId,
              staffId: catalog.staffId,
              from: temporal.from,
              to: temporal.to,
            };

      return { status: "ready", request };
    }

    if (
      input.bookingIntent !== "create_appointment" ||
      temporal.intent !== "create_appointment" ||
      catalog.staffId === null
    ) {
      return providerError();
    }

    const customerContext = await dependencies.loadBookingCustomerContext(
      input.organizationId,
      input.conversationId,
    );
    if (!customerContext.success) {
      return unavailable(customerContext.code, false);
    }

    const customerName =
      normalizeName(input.bookingRequest.customerName) ??
      normalizeName(customerContext.context.displayName);
    if (customerName === null) {
      return { status: "needs_input", field: "customerName" };
    }

    return {
      status: "ready",
      request: {
        intent: "create_appointment",
        serviceId: catalog.serviceId,
        staffId: catalog.staffId,
        startAt: temporal.startAt,
        customer: {
          name: customerName,
          phone: customerContext.context.phone,
        },
      },
    };
  } catch {
    return providerError();
  }
}
