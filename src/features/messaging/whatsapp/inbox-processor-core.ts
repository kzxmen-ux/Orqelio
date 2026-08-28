import type { DurableAiInboundProcessingResult } from "../../ai-runtime/durable-inbound-processing-core.ts";
import type { AiInboundProcessingInput } from "../../ai-runtime/inbound-processing-core.ts";

export type ImmediateAiReplyWhatsappExecutionCandidate = {
  organizationId: string;
  aiMessageRunId: string;
};

export function getImmediateAiReplyWhatsappExecutionCandidate(
  input: AiInboundProcessingInput,
  durableResult: DurableAiInboundProcessingResult,
): ImmediateAiReplyWhatsappExecutionCandidate | null {
  if (
    durableResult.outcome !== "completed" ||
    durableResult.aiResult.outcome !== "decided" ||
    durableResult.aiResult.decision.action !== "reply"
  ) {
    return null;
  }

  return {
    organizationId: input.organizationId,
    aiMessageRunId: durableResult.runId,
  };
}

export type WhatsappInboxProcessorResult =
  | {
      outcome: "processed";
      routedMessageCount: number;
      storedMessageCount: number;
      routedStatusCount: number;
      storedStatusCount: number;
      aiProcessingResults: readonly DurableAiInboundProcessingResult[];
    }
  | {
      outcome: "unavailable";
      routedMessageCount: 0;
      storedMessageCount: 0;
      routedStatusCount: 0;
      storedStatusCount: 0;
      aiProcessingResults: readonly [];
    };

type ClaimResult =
  | {
      outcome: "claimed";
      rawPayload: Record<string, unknown>;
    }
  | {
      outcome: "unavailable";
    };

type StoreResult = {
  outcome: "accepted" | "duplicate";
  conversationId: string;
  messageId: string;
};

export type WhatsappInboxProcessorDependencies<TMessage, TStatus> = {
  claimEvent: (eventId: string) => Promise<ClaimResult>;
  routePayload: (payload: unknown) => Promise<readonly TMessage[]>;
  routeStatuses: (payload: unknown) => Promise<readonly TStatus[]>;
  storeMessage: (message: TMessage) => Promise<StoreResult>;
  storeStatus: (status: TStatus) => Promise<unknown>;
  processDurableAi: (
    input: AiInboundProcessingInput,
  ) => Promise<DurableAiInboundProcessingResult>;
  completeEvent: (eventId: string) => Promise<unknown>;
  failEvent: (eventId: string, errorCode: string) => Promise<unknown>;
};

function processorFailure(): Error {
  return new Error("WhatsApp inbox processor failed.");
}

function getAiInput(
  message: unknown,
  storeResult: StoreResult,
): AiInboundProcessingInput | null {
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    !("type" in message) ||
    message.type !== "text" ||
    !("organizationId" in message) ||
    typeof message.organizationId !== "string" ||
    message.organizationId.length === 0
  ) {
    return null;
  }

  return {
    organizationId: message.organizationId,
    conversationId: storeResult.conversationId,
    triggerMessageId: storeResult.messageId,
  };
}

async function markFailed(
  eventId: string,
  errorCode:
    | "routing_failed"
    | "message_storage_failed"
    | "status_routing_failed"
    | "status_storage_failed",
  failEvent: WhatsappInboxProcessorDependencies<unknown, unknown>["failEvent"],
): Promise<never> {
  try {
    await failEvent(eventId, errorCode);
  } catch {
    throw processorFailure();
  }

  throw processorFailure();
}

export async function processWhatsappInboxEventWithDependencies<
  TMessage,
  TStatus,
>(
  eventId: string,
  dependencies: WhatsappInboxProcessorDependencies<TMessage, TStatus>,
): Promise<WhatsappInboxProcessorResult> {
  let claim: ClaimResult;

  try {
    claim = await dependencies.claimEvent(eventId);
  } catch {
    throw processorFailure();
  }

  if (claim.outcome === "unavailable") {
    return {
      outcome: "unavailable",
      routedMessageCount: 0,
      storedMessageCount: 0,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [],
    };
  }

  let messages: readonly TMessage[];

  try {
    messages = await dependencies.routePayload(claim.rawPayload);
  } catch {
    return markFailed(eventId, "routing_failed", dependencies.failEvent);
  }

  let statuses: readonly TStatus[];

  try {
    statuses = await dependencies.routeStatuses(claim.rawPayload);
  } catch {
    return markFailed(
      eventId,
      "status_routing_failed",
      dependencies.failEvent,
    );
  }

  let storedMessageCount = 0;
  const aiProcessingResults: DurableAiInboundProcessingResult[] = [];

  for (const message of messages) {
    let storeResult: StoreResult;

    try {
      storeResult = await dependencies.storeMessage(message);
      storedMessageCount += 1;
    } catch {
      return markFailed(
        eventId,
        "message_storage_failed",
        dependencies.failEvent,
      );
    }

    const aiInput = getAiInput(message, storeResult);

    if (aiInput) {
      try {
        aiProcessingResults.push(await dependencies.processDurableAi(aiInput));
      } catch {
        throw processorFailure();
      }
    }
  }

  let storedStatusCount = 0;

  for (const status of statuses) {
    try {
      await dependencies.storeStatus(status);
      storedStatusCount += 1;
    } catch {
      return markFailed(
        eventId,
        "status_storage_failed",
        dependencies.failEvent,
      );
    }
  }

  try {
    await dependencies.completeEvent(eventId);
  } catch {
    throw processorFailure();
  }

  return {
    outcome: "processed",
    routedMessageCount: messages.length,
    storedMessageCount,
    routedStatusCount: statuses.length,
    storedStatusCount,
    aiProcessingResults,
  };
}
