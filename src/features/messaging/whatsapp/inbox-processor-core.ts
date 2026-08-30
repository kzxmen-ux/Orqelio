import type { DurableAiInboundProcessingResult } from "../../ai-runtime/durable-inbound-processing-core.ts";
import type { AiInboundProcessingInput } from "../../ai-runtime/inbound-processing-core.ts";
import type { AiReplyWhatsappExecutionResult } from "./ai-reply-whatsapp-executor-core";
import type { AiBookingWhatsappExecutionResult } from "./ai-booking-whatsapp-executor-core";

export type ImmediateAiReplyWhatsappExecutionCandidate = {
  organizationId: string;
  aiMessageRunId: string;
};

export function getImmediateAiBookingExecutionCandidate(
  input: AiInboundProcessingInput,
  durableResult: DurableAiInboundProcessingResult,
): ImmediateAiReplyWhatsappExecutionCandidate | null {
  if (durableResult.outcome !== "completed" || durableResult.aiResult.outcome !== "decided" ||
    durableResult.aiResult.decision.action !== "booking_action_required") return null;
  return { organizationId: input.organizationId, aiMessageRunId: durableResult.runId };
}

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

export type ImmediateReplyExecutionSummary = {
  candidateCount: number;
  persistedCount: number;
  providerAcceptedCount: number;
  alreadyDispatchingCount: number;
  indeterminateCount: number;
  failedCount: number;
};

function createImmediateReplyExecutionSummary(
  candidateCount = 0,
): ImmediateReplyExecutionSummary {
  return {
    candidateCount,
    persistedCount: 0,
    providerAcceptedCount: 0,
    alreadyDispatchingCount: 0,
    indeterminateCount: 0,
    failedCount: 0,
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
      immediateReplyExecution: ImmediateReplyExecutionSummary;
      immediateBookingExecution?: ImmediateReplyExecutionSummary;
    }
  | {
      outcome: "unavailable";
      routedMessageCount: 0;
      storedMessageCount: 0;
      routedStatusCount: 0;
      storedStatusCount: 0;
      aiProcessingResults: readonly [];
      immediateReplyExecution: ImmediateReplyExecutionSummary;
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
  executeImmediateReply: (
    input: ImmediateAiReplyWhatsappExecutionCandidate,
  ) => Promise<AiReplyWhatsappExecutionResult>;
  executeImmediateBooking: (
    input: ImmediateAiReplyWhatsappExecutionCandidate,
  ) => Promise<AiBookingWhatsappExecutionResult>;
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
      immediateReplyExecution: createImmediateReplyExecutionSummary(),
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
  const immediateReplyCandidates: ImmediateAiReplyWhatsappExecutionCandidate[] =
    [];
  const immediateBookingCandidates: ImmediateAiReplyWhatsappExecutionCandidate[] = [];

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
      let durableResult: DurableAiInboundProcessingResult;

      try {
        durableResult = await dependencies.processDurableAi(aiInput);
      } catch {
        throw processorFailure();
      }

      aiProcessingResults.push(durableResult);

      const candidate = getImmediateAiReplyWhatsappExecutionCandidate(
        aiInput,
        durableResult,
      );

      if (candidate) immediateReplyCandidates.push(candidate);
      const bookingCandidate = getImmediateAiBookingExecutionCandidate(aiInput, durableResult);
      if (bookingCandidate) immediateBookingCandidates.push(bookingCandidate);
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

  const immediateReplyExecution = createImmediateReplyExecutionSummary(
    immediateReplyCandidates.length,
  );

  for (const candidate of immediateReplyCandidates) {
    try {
      const execution = await dependencies.executeImmediateReply(candidate);

      switch (execution.outcome) {
        case "persisted":
          immediateReplyExecution.persistedCount += 1;
          break;
        case "provider_accepted":
          immediateReplyExecution.providerAcceptedCount += 1;
          break;
        case "already_dispatching":
          immediateReplyExecution.alreadyDispatchingCount += 1;
          break;
        case "indeterminate":
          immediateReplyExecution.indeterminateCount += 1;
          break;
      }
    } catch {
      immediateReplyExecution.failedCount += 1;
    }
  }

  const immediateBookingExecution = createImmediateReplyExecutionSummary(immediateBookingCandidates.length);
  for (const candidate of immediateBookingCandidates) {
    try {
      const execution = await dependencies.executeImmediateBooking(candidate);
      switch (execution.outcome) {
        case "persisted": immediateBookingExecution.persistedCount += 1; break;
        case "provider_accepted": immediateBookingExecution.providerAcceptedCount += 1; break;
        case "already_executing":
        case "already_dispatching": immediateBookingExecution.alreadyDispatchingCount += 1; break;
        case "indeterminate": immediateBookingExecution.indeterminateCount += 1; break;
      }
    } catch {
      // The durable run/journal is recovered by the existing scheduled worker.
      immediateBookingExecution.failedCount += 1;
    }
  }

  return {
    outcome: "processed",
    routedMessageCount: messages.length,
    storedMessageCount,
    routedStatusCount: statuses.length,
    storedStatusCount,
    aiProcessingResults,
    immediateReplyExecution,
    ...(immediateBookingCandidates.length ? { immediateBookingExecution } : {}),
  };
}
