import type { AiManagerConfiguration } from "../ai-manager-settings/types";
import { buildHandoffPolicy } from "./policy.ts";
import type { HandoffPolicy } from "./types";

export type HandoffPolicyLoaderDependencies = {
  getConfiguration: (organizationId: string) => Promise<AiManagerConfiguration | null>;
  isAuthorized: (organizationId: string) => Promise<boolean>;
};

export async function loadAuthorizedHandoffPolicy(
  organizationId: string,
  dependencies: HandoffPolicyLoaderDependencies,
): Promise<HandoffPolicy | null> {
  if (!(await dependencies.isAuthorized(organizationId))) {
    return null;
  }

  const configuration = await dependencies.getConfiguration(organizationId);
  if (configuration && configuration.organizationId !== organizationId) {
    return null;
  }

  return buildHandoffPolicy(organizationId, configuration);
}
