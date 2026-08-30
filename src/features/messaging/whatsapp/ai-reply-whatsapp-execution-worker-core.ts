import type { AiBookingWhatsappExecutionResult } from "./ai-booking-whatsapp-executor-core";
import type {
  ActionableAiReplyWhatsappExecution,
  QuarantineStaleAiReplyWhatsappDispatchesResult,
} from "./outbound-dispatch-repository-core";

const SAFE_WORKER_ERROR = "AI reply WhatsApp execution worker failed.";

export type AiReplyWhatsappExecutionWorkerResult = {
  quarantinedCount: number;
  candidateCount: number;
  persistedCount: number;
  providerAcceptedCount: number;
  alreadyDispatchingCount: number;
  indeterminateCount: number;
  failedCount: number;
};

export type AiReplyWhatsappExecutionWorkerDependencies = {
  quarantineStale: (
    limit?: number,
  ) => Promise<QuarantineStaleAiReplyWhatsappDispatchesResult>;
  listActionable: (
    limit?: number,
  ) => Promise<readonly ActionableAiReplyWhatsappExecution[]>;
  executeReply: (
    input: ActionableAiReplyWhatsappExecution,
  ) => Promise<AiBookingWhatsappExecutionResult>;
};

function workerFailure(): Error {
  return new Error(SAFE_WORKER_ERROR);
}

export async function runAiReplyWhatsappExecutionWorkerWithDependencies(
  limit: number | undefined,
  dependencies: AiReplyWhatsappExecutionWorkerDependencies,
): Promise<AiReplyWhatsappExecutionWorkerResult> {
  let quarantinedCount: number;

  try {
    const quarantineResult = await dependencies.quarantineStale(limit);
    quarantinedCount = quarantineResult.quarantinedCount;
  } catch {
    throw workerFailure();
  }

  let candidates: readonly ActionableAiReplyWhatsappExecution[];

  try {
    candidates = await dependencies.listActionable(limit);
  } catch {
    throw workerFailure();
  }

  const result: AiReplyWhatsappExecutionWorkerResult = {
    alreadyDispatchingCount: 0,
    candidateCount: candidates.length,
    failedCount: 0,
    indeterminateCount: 0,
    persistedCount: 0,
    providerAcceptedCount: 0,
    quarantinedCount,
  };

  for (const candidate of candidates) {
    try {
      const execution = await dependencies.executeReply({
        aiMessageRunId: candidate.aiMessageRunId,
        organizationId: candidate.organizationId,
      });

      switch (execution.outcome) {
        case "automation_disabled":
          break;
        case "persisted":
          result.persistedCount += 1;
          break;
        case "provider_accepted":
          result.providerAcceptedCount += 1;
          break;
        case "already_dispatching":
        case "already_executing":
          result.alreadyDispatchingCount += 1;
          break;
        case "indeterminate":
          result.indeterminateCount += 1;
          break;
      }
    } catch {
      result.failedCount += 1;
    }
  }

  return result;
}
