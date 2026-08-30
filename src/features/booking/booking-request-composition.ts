import "server-only";

import { resolveBookingCatalog } from "./booking-catalog-resolution-core";
import { resolveSafeBookingToolsForOrganization } from "./booking-context-resolver";
import { loadBookingCustomerContext } from "./booking-customer-context";
import {
  composeBookingRequestForOrganizationCore,
  type BookingRequestCompositionInput,
  type BookingRequestCompositionResult,
} from "./booking-request-composition-core";
import { resolveBookingTemporal } from "./booking-temporal-resolution-core";
import { loadBookingTimeContextForOrganization } from "./booking-time-context";

export function composeBookingRequestForOrganization(
  input: BookingRequestCompositionInput,
): Promise<BookingRequestCompositionResult> {
  return composeBookingRequestForOrganizationCore(input, {
    resolveSafeBookingToolsForOrganization,
    resolveBookingCatalog,
    loadBookingTimeContextForOrganization,
    resolveBookingTemporal,
    loadBookingCustomerContext,
  });
}

export type {
  BookingRequestCompositionInput,
  BookingRequestCompositionResult,
} from "./booking-request-composition-core";
