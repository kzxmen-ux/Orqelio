import type {
  ConversationAiContext,
  ConversationAiContextInput,
  ConversationAiContextResult,
} from "./conversation-context-core.ts";
import { buildAiRuntimeDecision } from "./decision-core.ts";
import type { AiRuntimeDecision } from "./decision-types.ts";
import type {
  OpenAiTransportResult,
  OpenAiTransportUsage,
} from "./openai-transport-core.ts";

export type AiRuntimeBlockedReason = Extract<
  ConversationAiContextResult,
  { outcome: "blocked" }
>["reason"];

export type AiRuntimeFailureReason =
  | Extract<OpenAiTransportResult, { outcome: "failure" }>["reason"]
  | "runtime_error";

export type AiRuntimeResult =
  | {
      outcome: "decided";
      decision: AiRuntimeDecision;
      model: string;
      usage: OpenAiTransportUsage | null;
    }
  | {
      outcome: "blocked";
      reason: AiRuntimeBlockedReason;
    }
  | {
      outcome: "failure";
      reason: AiRuntimeFailureReason;
    };

export type AiRuntimeDependencies = {
  loadContext: (
    input: ConversationAiContextInput,
  ) => Promise<ConversationAiContextResult>;
  requestModelProposal: (
    context: ConversationAiContext,
  ) => Promise<OpenAiTransportResult>;
};

export async function runAiRuntimeWithDependencies(
  input: ConversationAiContextInput,
  dependencies: AiRuntimeDependencies,
): Promise<AiRuntimeResult> {
  let contextResult: ConversationAiContextResult;

  try {
    contextResult = await dependencies.loadContext(input);
  } catch {
    return { outcome: "failure", reason: "runtime_error" };
  }

  if (contextResult.outcome === "blocked") {
    return { outcome: "blocked", reason: contextResult.reason };
  }

  let transportResult: OpenAiTransportResult;

  try {
    transportResult = await dependencies.requestModelProposal(
      contextResult.context,
    );
  } catch {
    return { outcome: "failure", reason: "runtime_error" };
  }

  if (transportResult.outcome === "failure") {
    return { outcome: "failure", reason: transportResult.reason };
  }

  return {
    outcome: "decided",
    decision: buildAiRuntimeDecision(
      contextResult.context,
      transportResult.proposal,
    ),
    model: transportResult.model,
    usage: transportResult.usage,
  };
}
