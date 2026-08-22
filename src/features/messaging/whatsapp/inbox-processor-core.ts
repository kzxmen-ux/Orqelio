export type WhatsappInboxProcessorResult =
  | {
      outcome: "processed";
      routedMessageCount: number;
      storedMessageCount: number;
      routedStatusCount: number;
      storedStatusCount: number;
    }
  | {
      outcome: "unavailable";
      routedMessageCount: 0;
      storedMessageCount: 0;
      routedStatusCount: 0;
      storedStatusCount: 0;
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

export type WhatsappInboxProcessorDependencies<TMessage, TStatus> = {
  claimEvent: (eventId: string) => Promise<ClaimResult>;
  routePayload: (payload: unknown) => Promise<readonly TMessage[]>;
  routeStatuses: (payload: unknown) => Promise<readonly TStatus[]>;
  storeMessage: (message: TMessage) => Promise<StoreResult>;
  storeStatus: (status: TStatus) => Promise<unknown>;
  completeEvent: (eventId: string) => Promise<unknown>;
  failEvent: (eventId: string, errorCode: string) => Promise<unknown>;
};

function processorFailure(): Error {
  return new Error("WhatsApp inbox processor failed.");
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
  };
}
