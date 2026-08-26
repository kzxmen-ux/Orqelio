import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import type {
  AiInboundProcessingInput,
  AiInboundProcessingResult,
} from "./inbound-processing-core.ts";
import {
  claimAiMessageRunWithRpc,
  recoverStaleAiMessageRunsWithRpc,
  storeAiMessageRunTerminalResultWithRpc,
  type AiMessageRunClaimResult,
  type AiMessageRunRecoveryResult,
  type AiMessageRunRpc,
  type AiMessageRunTerminalStoreResult,
} from "./message-run-repository-core.ts";

const callRpc: AiMessageRunRpc = async (functionName, parameters) => {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase.rpc(functionName, parameters);

  return { data, error };
};

export function claimAiMessageRun(
  input: AiInboundProcessingInput,
): Promise<AiMessageRunClaimResult> {
  return claimAiMessageRunWithRpc(input, callRpc);
}

export function storeAiMessageRunTerminalResult(
  runId: string,
  result: AiInboundProcessingResult,
): Promise<AiMessageRunTerminalStoreResult> {
  return storeAiMessageRunTerminalResultWithRpc(runId, result, callRpc);
}

export function recoverStaleAiMessageRuns(
  limit?: number,
): Promise<AiMessageRunRecoveryResult> {
  return recoverStaleAiMessageRunsWithRpc(limit, callRpc);
}
