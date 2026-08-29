import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import type { CrmConnection } from "../crm-connections/types";
import { getBookingProvider } from "../crm-connections/providers/booking-provider-registry";
import {
  resolveSafeBookingToolsForOrganizationCore,
  type BookingContextResolutionResult,
} from "./booking-context-resolver-core";
import { parseBookingCrmConnectionRows } from "./booking-context-resolver-rows";

async function loadOrganizationConnections(
  organizationId: string,
): Promise<readonly CrmConnection[]> {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase
    .from("crm_connections")
    .select(
      "id, organization_id, provider, display_name, status, configuration, created_at, updated_at, last_sync_at",
    )
    .eq("organization_id", organizationId);

  if (error) {
    throw new Error("CRM connections are unavailable");
  }

  const connections = parseBookingCrmConnectionRows(data);
  if (connections === null) {
    throw new Error("CRM connections are unavailable");
  }

  return connections;
}

export async function resolveSafeBookingToolsForOrganization(
  organizationId: string,
): Promise<BookingContextResolutionResult> {
  return resolveSafeBookingToolsForOrganizationCore(organizationId, {
    loadConnections: loadOrganizationConnections,
    getProvider: getBookingProvider,
  });
}

export type { BookingContextResolutionResult } from "./booking-context-resolver-core";
