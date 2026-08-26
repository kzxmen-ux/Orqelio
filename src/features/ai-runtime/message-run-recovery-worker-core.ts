import type { DurableAiInboundProcessingResult } from "./durable-inbound-processing-core.ts";
import type { AiInboundProcessingInput } from "./inbound-processing-core.ts";
import type {
  AiMessageRunRecoveryCandidate,
  AiMessageRunRecoveryResult,
} from "./message-run-repository-core.ts";

export type AiMessageRunRecoveryWorkerResult = {
  recoveredRetryableCount: number;
  exhaustedCount: number;
  pendingCandidateCount: number;
  completedCount: number;
  alreadyProcessingCount: number;
  alreadyTerminalCount: number;
  failedCount: number;
};

export type AiMessageRunRecoveryWorkerDependencies = {
  recoverStale: (limit?: number) => Promise<AiMessageRunRecoveryResult>;
  listPending: (
    limit?: number,
  ) => Promise<readonly AiMessageRunRecoveryCandidate[]>;
  processDurable: (
    input: AiInboundProcessingInput,
  ) => Promise<DurableAiInboundProcessingResult>;
};

function recoveryWorkerFailure(): Error {
  return new Error("AI message run recovery worker failed.");
}

export async function runAiMessageRunRecoveryWorkerWithDependencies(
  limit: number | undefined,
  dependencies: AiMessageRunRecoveryWorkerDependencies,
): Promise<AiMessageRunRecoveryWorkerResult> {
  let recovery: AiMessageRunRecoveryResult;

  try {
    recovery = await dependencies.recoverStale(limit);
  } catch {
    throw recoveryWorkerFailure();
  }

  let pendingCandidates: readonly AiMessageRunRecoveryCandidate[];

  try {
    pendingCandidates = await dependencies.listPending(limit);
  } catch {
    throw recoveryWorkerFailure();
  }

  const result: AiMessageRunRecoveryWorkerResult = {
    recoveredRetryableCount: recovery.retryable.length,
    exhaustedCount: recovery.exhaustedCount,
    pendingCandidateCount: pendingCandidates.length,
    completedCount: 0,
    alreadyProcessingCount: 0,
    alreadyTerminalCount: 0,
    failedCount: 0,
  };

  for (const candidate of pendingCandidates) {
    let processingResult: DurableAiInboundProcessingResult;

    try {
      processingResult = await dependencies.processDurable({
        organizationId: candidate.organizationId,
        conversationId: candidate.conversationId,
        triggerMessageId: candidate.triggerMessageId,
      });
    } catch {
      result.failedCount += 1;
      continue;
    }

    if (processingResult.outcome === "completed") {
      result.completedCount += 1;
    } else if (processingResult.outcome === "already_processing") {
      result.alreadyProcessingCount += 1;
    } else {
      result.alreadyTerminalCount += 1;
    }
  }

  return result;
}
