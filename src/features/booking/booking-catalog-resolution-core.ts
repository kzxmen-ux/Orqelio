import type { ModelBookingRequest } from "../ai-runtime/decision-types";
import type { BookingProviderOperationFailureCode } from "../crm-connections/providers/booking-operations";
import type { SafeBookingTools } from "./safe-booking-tools-core";

export type BookingCatalogResolutionInput = {
  intent: "check_availability" | "create_appointment";
  bookingRequest: ModelBookingRequest;
};

export type BookingCatalogResolutionField = "serviceQuery" | "staffQuery";

export type BookingCatalogResolutionResult =
  | {
      status: "resolved";
      serviceId: string;
      staffId: string | null;
    }
  | {
      status: "needs_input";
      field: BookingCatalogResolutionField;
    }
  | {
      status: "needs_clarification";
      field: BookingCatalogResolutionField;
      options: readonly string[];
    }
  | {
      status: "failed";
      code: BookingProviderOperationFailureCode;
      retryable: boolean;
    };

type NamedCatalogItem = {
  id: string;
  name: string;
};

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizeForMatch(value: string): string {
  return normalizeDisplayName(value).toLowerCase();
}

function displayNameOptions(
  items: readonly NamedCatalogItem[],
): readonly string[] {
  const normalizedNames = new Set<string>();
  const options: string[] = [];

  for (const item of items) {
    const displayName = normalizeDisplayName(item.name);
    const normalizedName = displayName.toLowerCase();
    if (displayName.length === 0 || normalizedNames.has(normalizedName)) {
      continue;
    }

    normalizedNames.add(normalizedName);
    options.push(displayName);
  }

  return options;
}

function exactNameMatches<T extends NamedCatalogItem>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const normalizedQuery = normalizeForMatch(query);
  return items.filter(
    (item) => normalizeForMatch(item.name) === normalizedQuery,
  );
}

function failed(
  code: BookingProviderOperationFailureCode,
  retryable: boolean,
): BookingCatalogResolutionResult {
  return { status: "failed", code, retryable };
}

function providerError(): BookingCatalogResolutionResult {
  return failed("provider_error", false);
}

export async function resolveBookingCatalog(
  input: BookingCatalogResolutionInput,
  tools: SafeBookingTools,
): Promise<BookingCatalogResolutionResult> {
  const serviceQuery = input.bookingRequest.serviceQuery;
  if (serviceQuery === null || normalizeDisplayName(serviceQuery).length === 0) {
    return { status: "needs_input", field: "serviceQuery" };
  }

  try {
    const servicesResult = await tools.findServices();
    if (!servicesResult.success) {
      return failed(servicesResult.code, servicesResult.retryable);
    }

    const serviceMatches = exactNameMatches(
      servicesResult.data,
      serviceQuery,
    );
    if (serviceMatches.length !== 1) {
      return {
        status: "needs_clarification",
        field: "serviceQuery",
        options: displayNameOptions(servicesResult.data),
      };
    }

    const serviceId = serviceMatches[0].id;
    const staffQuery = input.bookingRequest.staffQuery;
    const normalizedStaffQuery =
      staffQuery === null ? null : normalizeDisplayName(staffQuery);

    if (
      input.intent === "check_availability" &&
      (normalizedStaffQuery === null || normalizedStaffQuery.length === 0)
    ) {
      return { status: "resolved", serviceId, staffId: null };
    }

    const staffResult = await tools.findStaff({ serviceId });
    if (!staffResult.success) {
      return failed(staffResult.code, staffResult.retryable);
    }

    if (normalizedStaffQuery !== null && normalizedStaffQuery.length > 0) {
      const staffMatches = exactNameMatches(
        staffResult.data,
        normalizedStaffQuery,
      );
      if (staffMatches.length !== 1) {
        return {
          status: "needs_clarification",
          field: "staffQuery",
          options: displayNameOptions(staffResult.data),
        };
      }

      return {
        status: "resolved",
        serviceId,
        staffId: staffMatches[0].id,
      };
    }

    if (staffResult.data.length === 0) {
      return failed("not_found", false);
    }

    if (staffResult.data.length > 1) {
      return {
        status: "needs_clarification",
        field: "staffQuery",
        options: displayNameOptions(staffResult.data),
      };
    }

    return {
      status: "resolved",
      serviceId,
      staffId: staffResult.data[0].id,
    };
  } catch {
    return providerError();
  }
}
