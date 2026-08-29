import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  isIanaTimeZone,
  loadBookingTimeContextForOrganizationCore,
  type BookingTimeContextResult,
} from "./booking-time-context-core";

async function loadOrganizationRows(organizationId: string): Promise<unknown> {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, timezone")
    .eq("id", organizationId)
    .limit(2);

  if (error) {
    throw new Error("Booking time context is unavailable");
  }

  return data;
}

export async function loadBookingTimeContextForOrganization(
  organizationId: string,
): Promise<BookingTimeContextResult> {
  return loadBookingTimeContextForOrganizationCore(organizationId, {
    loadOrganizationRows,
    isValidTimeZone: isIanaTimeZone,
  });
}

export type {
  BookingTimeContext,
  BookingTimeContextResult,
} from "./booking-time-context-core";
