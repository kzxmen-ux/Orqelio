import type { AiRuntimeResult } from "./runtime-core.ts";

export type AiInboundProcessingInput = {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
};

type AiRuntimeDecidedResult = Extract<
  AiRuntimeResult,
  { outcome: "decided" }
>;
type AiRuntimeBlockedResult = Extract<
  AiRuntimeResult,
  { outcome: "blocked" }
>;
type AiRuntimeFailureResult = Extract<
  AiRuntimeResult,
  { outcome: "failure" }
>;

export type AiInboundProcessingResult =
  | {
      outcome: "decided";
      decision: AiRuntimeDecidedResult["decision"];
    }
  | {
      outcome: "blocked";
      reason: AiRuntimeBlockedResult["reason"];
    }
  | {
      outcome: "failed";
      reason: AiRuntimeFailureResult["reason"];
    };

export type AiInboundProcessingDependencies = {
  runRuntime: (input: AiInboundProcessingInput) => Promise<AiRuntimeResult>;
};

export async function processAiInboundMessageWithDependencies(
  input: AiInboundProcessingInput,
  dependencies: AiInboundProcessingDependencies,
): Promise<AiInboundProcessingResult> {
  let runtimeResult: AiRuntimeResult;

  try {
    runtimeResult = await dependencies.runRuntime(input);
  } catch {
    return { outcome: "failed", reason: "runtime_error" };
  }

  if (runtimeResult.outcome === "decided") {
    return {
      outcome: "decided",
      decision: runtimeResult.decision,
    };
  }

  if (runtimeResult.outcome === "blocked") {
    return {
      outcome: "blocked",
      reason: runtimeResult.reason,
    };
  }

  return {
    outcome: "failed",
    reason: runtimeResult.reason,
  };
}
