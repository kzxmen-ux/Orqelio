import "server-only";

import { getBookingProvider } from "@/features/crm-connections/providers/booking-provider-registry";
import { listCrmConnections } from "@/features/crm-connections/queries/crm-connections";
import { createClient } from "@/lib/supabase/server";

import {
  type AltegioDashboardStatus,
  resolveAltegioDashboardConnection,
} from "../dashboard-state";

export type OrganizationDashboardData = {
  aiManagerStatus: "draft" | "ready" | null;
  altegio: {
    connectionId: string | null;
    providerLabel: string;
    settingsDescription: string | null;
    status: AltegioDashboardStatus;
  };
  memberCount: number | null;
};

async function getAiManagerStatus(
  organizationId: string,
): Promise<"draft" | "ready" | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_manager_configurations")
    .select("status")
    .eq("organization_id", organizationId)
    .maybeSingle<{ status: "draft" | "ready" }>();

  return error || !data ? null : data.status;
}

async function getOrganizationMemberCount(
  organizationId: string,
): Promise<number | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    return null;
  }

  const { count, error } = await supabase
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  return error ? null : count;
}

export async function getOrganizationDashboardData(
  organizationId: string,
): Promise<OrganizationDashboardData> {
  const [connections, memberCount, aiManagerStatus] = await Promise.all([
    listCrmConnections(organizationId),
    getOrganizationMemberCount(organizationId),
    getAiManagerStatus(organizationId),
  ]);
  const resolvedAltegio = resolveAltegioDashboardConnection(connections);
  const altegioConnection = resolvedAltegio.connection;

  if (!altegioConnection) {
    return {
      aiManagerStatus,
      altegio: {
        connectionId: null,
        providerLabel: "Altegio",
        settingsDescription: null,
        status: "not_connected",
      },
      memberCount,
    };
  }

  const metadata = await getBookingProvider(
    altegioConnection.provider,
  ).getConnectionMetadata(altegioConnection);

  return {
    aiManagerStatus,
    altegio: {
      connectionId: altegioConnection.id,
      providerLabel: metadata?.providerLabel ?? "Altegio",
      settingsDescription: metadata?.settingsDescription ?? null,
      status: resolvedAltegio.status,
    },
    memberCount,
  };
}
