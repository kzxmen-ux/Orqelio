import type {
  AiInboundProcessingInput,
  AiInboundProcessingResult,
} from "./inbound-processing-core.ts";
import type {
  AiMessageRunClaimResult,
  AiMessageRunTerminalStoreResult,
} from "./message-run-repository-core.ts";

type AiMessageRunTerminalStatus = "decided" | "blocked" | "failed";

export type DurableAiInboundProcessingResult =
  | {
      outcome: "completed";
      aiResult: AiInboundProcessingResult;
    }
  | {
      outcome: "already_processing";
    }
  | {
      outcome: "already_terminal";
      status: AiMessageRunTerminalStatus;
    };

export type DurableAiInboundProcessingDependencies = {
  claimRun: (
    input: AiInboundProcessingInput,
  ) => Promise<AiMessageRunClaimResult>;
  processAi: (
    input: AiInboundProcessingInput,
  ) => Promise<AiInboundProcessingResult>;
  storeTerminalResult: (
    runId: string,
    result: AiInboundProcessingResult,
  ) => Promise<AiMessageRunTerminalStoreResult>;
};

function durableOrchestrationFailure(): Error {
  return new Error("Durable AI inbound processing failed.");
}

export async function processDurableAiInboundMessageWithDependencies(
  input: AiInboundProcessingInput,
  dependencies: DurableAiInboundProcessingDependencies,
): Promise<DurableAiInboundProcessingResult> {
  let claim: AiMessageRunClaimResult;

  try {
    claim = await dependencies.claimRun(input);
  } catch {
    throw durableOrchestrationFailure();
  }

  if (claim.outcome === "already_processing") {
    return { outcome: "already_processing" };
  }

  if (claim.outcome === "already_terminal") {
    return {
      outcome: "already_terminal",
      status: claim.status,
    };
  }

  let aiResult: AiInboundProcessingResult;

  try {
    aiResult = await dependencies.processAi(input);
  } catch {
    aiResult = { outcome: "failed", reason: "runtime_error" };
  }

  let terminalResult: AiMessageRunTerminalStoreResult;

  try {
    terminalResult = await dependencies.storeTerminalResult(
      claim.runId,
      aiResult,
    );
  } catch {
    throw durableOrchestrationFailure();
  }

  if (terminalResult.runId !== claim.runId) {
    throw durableOrchestrationFailure();
  }

  if (terminalResult.outcome === "already_terminal") {
    return {
      outcome: "already_terminal",
      status: terminalResult.status,
    };
  }

  if (terminalResult.status !== aiResult.outcome) {
    throw durableOrchestrationFailure();
  }

  return {
    outcome: "completed",
    aiResult,
  };
}
