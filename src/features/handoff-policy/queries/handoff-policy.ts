import "server-only";

import { getAiManagerConfiguration } from "@/features/ai-manager-settings/queries/ai-manager-settings";
import { getOrganizationForCurrentUser } from "@/features/organizations/queries/organizations";
import { organizationIdSchema } from "@/features/organizations/validation/organization";

import { loadAuthorizedHandoffPolicy } from "../loader";
import type { HandoffPolicy, HandoffReadiness } from "../types";

export async function getHandoffPolicy(
  organizationId: string,
): Promise<HandoffPolicy | null> {
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return null;
  }

  return loadAuthorizedHandoffPolicy(parsedOrganizationId.data, {
    getConfiguration: getAiManagerConfiguration,
    isAuthorized: async (targetOrganizationId) =>
      (await getOrganizationForCurrentUser(targetOrganizationId)) !== null,
  });
}

export async function getHandoffPolicyReadiness(
  organizationId: string,
): Promise<HandoffReadiness | null> {
  return (await getHandoffPolicy(organizationId))?.readiness ?? null;
}
