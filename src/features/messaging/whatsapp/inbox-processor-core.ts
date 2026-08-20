export type WhatsappInboxProcessorResult =
  | {
      outcome: "processed";
      routedMessageCount: number;
      storedMessageCount: number;
    }
  | {
      outcome: "unavailable";
      routedMessageCount: 0;
      storedMessageCount: 0;
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
};

export type WhatsappInboxProcessorDependencies<TMessage> = {
  claimEvent: (eventId: string) => Promise<ClaimResult>;
  routePayload: (payload: unknown) => Promise<readonly TMessage[]>;
  storeMessage: (message: TMessage) => Promise<StoreResult>;
  completeEvent: (eventId: string) => Promise<unknown>;
  failEvent: (eventId: string, errorCode: string) => Promise<unknown>;
};

function processorFailure(): Error {
  return new Error("WhatsApp inbox processor failed.");
}

async function markFailed(
  eventId: string,
  errorCode: "routing_failed" | "message_storage_failed",
  failEvent: WhatsappInboxProcessorDependencies<unknown>["failEvent"],
): Promise<never> {
  try {
    await failEvent(eventId, errorCode);
  } catch {
    throw processorFailure();
  }

  throw processorFailure();
}

export async function processWhatsappInboxEventWithDependencies<TMessage>(
  eventId: string,
  dependencies: WhatsappInboxProcessorDependencies<TMessage>,
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
    };
  }

  let messages: readonly TMessage[];

  try {
    messages = await dependencies.routePayload(claim.rawPayload);
  } catch {
    return markFailed(eventId, "routing_failed", dependencies.failEvent);
  }

  let storedMessageCount = 0;

  for (const message of messages) {
    try {
      await dependencies.storeMessage(message);
      storedMessageCount += 1;
    } catch {
      return markFailed(
        eventId,
        "message_storage_failed",
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
  };
}
