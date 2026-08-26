import "server-only";

import { processDurableAiInboundMessage } from "./durable-inbound-processing.ts";
import {
  runAiMessageRunRecoveryWorkerWithDependencies,
  type AiMessageRunRecoveryWorkerResult,
} from "./message-run-recovery-worker-core.ts";
import {
  listPendingAiMessageRuns,
  recoverStaleAiMessageRuns,
} from "./message-run-repository.ts";

export function runAiMessageRunRecoveryWorker(
  limit?: number,
): Promise<AiMessageRunRecoveryWorkerResult> {
  return runAiMessageRunRecoveryWorkerWithDependencies(limit, {
    recoverStale: recoverStaleAiMessageRuns,
    listPending: listPendingAiMessageRuns,
    processDurable: processDurableAiInboundMessage,
  });
}
