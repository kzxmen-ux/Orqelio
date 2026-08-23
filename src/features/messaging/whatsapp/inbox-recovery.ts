import "server-only";

import {
  createWhatsappInboxRecoveryCandidateFinder,
  recoverWhatsappInboxWithDependencies,
  type WhatsappInboxRecoveryResult,
  type WhatsappInboxRecoveryRpc,
} from "./inbox-recovery-core";
import { processWhatsappInboxEvent } from "./inbox-processor";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

const privilegedRpc: WhatsappInboxRecoveryRpc = async (
  functionName,
  parameters,
) => {
  const { data, error } = await createPrivilegedClient().rpc(
    functionName,
    parameters,
  );

  return { data, error };
};

const findCandidates = createWhatsappInboxRecoveryCandidateFinder(privilegedRpc);

export function recoverWhatsappInbox(
  requestedLimit?: number,
): Promise<WhatsappInboxRecoveryResult> {
  return recoverWhatsappInboxWithDependencies(
    {
      findCandidates,
      processEvent: processWhatsappInboxEvent,
    },
    requestedLimit,
  );
}
