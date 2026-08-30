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
  const { data, error } = await supabase
    .from("ai_message_runs")
    .select("id, organization_id, conversation_id, status, decision")
    .eq("id", aiMessageRunId)
    .eq("organization_id", organizationId)
    .eq("status", "decided")
    .limit(2);

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
