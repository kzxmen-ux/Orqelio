import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  loadBookingActionSourceCore,
  type BookingActionSourceResult,
} from "./booking-action-source-repository-core";

async function loadRows(
  organizationId: string,
  aiMessageRunId: string,
): Promise<unknown> {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase.rpc("load_booking_action_source", {
    p_organization_id: organizationId,
    p_ai_message_run_id: aiMessageRunId,
  });

  if (error) throw new Error("Booking action source is unavailable");
  return data;
}

export function loadBookingActionSource(
  organizationId: string,
  aiMessageRunId: string,
): Promise<BookingActionSourceResult> {
  return loadBookingActionSourceCore(
    organizationId,
    aiMessageRunId,
    { loadRows },
  );
}

export type {
  BookingActionSource,
  BookingActionSourceResult,
} from "./booking-action-source-repository-core";
