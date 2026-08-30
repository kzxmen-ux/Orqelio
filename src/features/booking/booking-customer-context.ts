import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  loadBookingCustomerContextCore,
  type BookingCustomerContextResult,
} from "./booking-customer-context-core";

async function loadConversationRows(
  organizationId: string,
  conversationId: string,
): Promise<unknown> {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(
      `
        id,
        organization_id,
        channel,
        channel_connection_id,
        external_participant_id,
        display_name,
        connection:whatsapp_channel_connections!conversations_channel_connection_id_fkey!inner (
          id,
          organization_id,
          status
        )
      `,
    )
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .eq("channel", "whatsapp")
    .eq("connection.organization_id", organizationId)
    .eq("connection.status", "active")
    .limit(2);

  if (error) {
    throw new Error("Booking customer context is unavailable");
  }

  return data;
}

export function loadBookingCustomerContext(
  organizationId: string,
  conversationId: string,
): Promise<BookingCustomerContextResult> {
  return loadBookingCustomerContextCore(organizationId, conversationId, {
    loadConversationRows,
  });
}

export type {
  BookingCustomerContext,
  BookingCustomerContextResult,
} from "./booking-customer-context-core";
