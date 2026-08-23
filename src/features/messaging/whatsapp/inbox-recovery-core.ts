export type WhatsappInboxRecoveryResult = {
  candidateCount: number;
  processedCount: number;
  unavailableCount: number;
  failedCount: number;
};

type RecoveryRpcResponse = {
  data: unknown;
  error: unknown;
};

export type WhatsappInboxRecoveryRpc = (
  functionName: "recover_whatsapp_webhook_inbox",
  parameters: { p_limit: number },
) => Promise<RecoveryRpcResponse>;

export type WhatsappInboxRecoveryProcessor = (
  eventId: string,
) => Promise<{ outcome: "processed" | "unavailable" }>;

export type WhatsappInboxRecoveryDependencies = {
  findCandidates: (limit: number) => Promise<readonly string[]>;
  processEvent: WhatsappInboxRecoveryProcessor;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RECOVERY_LIMIT = 25;
const MIN_RECOVERY_LIMIT = 1;
const MAX_RECOVERY_LIMIT = 50;

function recoveryFailure(): Error {
  return new Error("WhatsApp inbox recovery failed.");
}

function normalizeLimit(requestedLimit: number | undefined): number {
  if (requestedLimit === undefined) {
    return DEFAULT_RECOVERY_LIMIT;
  }

  if (!Number.isFinite(requestedLimit)) {
    return DEFAULT_RECOVERY_LIMIT;
  }

  return Math.min(
    MAX_RECOVERY_LIMIT,
    Math.max(MIN_RECOVERY_LIMIT, Math.trunc(requestedLimit)),
  );
}

function normalizeCandidateRows(data: unknown): string[] {
  if (!Array.isArray(data)) {
    throw recoveryFailure();
  }

  const eventIds: string[] = [];
  const seenEventIds = new Set<string>();

  for (const row of data) {
    if (
      typeof row !== "object" ||
      row === null ||
      Array.isArray(row) ||
      !("event_id" in row) ||
      typeof row.event_id !== "string" ||
      !UUID_PATTERN.test(row.event_id) ||
      seenEventIds.has(row.event_id)
    ) {
      throw recoveryFailure();
    }

    eventIds.push(row.event_id);
    seenEventIds.add(row.event_id);
  }

  return eventIds;
}

export function createWhatsappInboxRecoveryCandidateFinder(
  rpc: WhatsappInboxRecoveryRpc,
): (limit: number) => Promise<readonly string[]> {
  return async (limit: number): Promise<readonly string[]> => {
    let response: RecoveryRpcResponse;

    try {
      response = await rpc("recover_whatsapp_webhook_inbox", {
        p_limit: normalizeLimit(limit),
      });
    } catch {
      throw recoveryFailure();
    }

    if (response.error !== null && response.error !== undefined) {
      throw recoveryFailure();
    }

    return normalizeCandidateRows(response.data);
  };
}

export async function recoverWhatsappInboxWithDependencies(
  dependencies: WhatsappInboxRecoveryDependencies,
  requestedLimit?: number,
): Promise<WhatsappInboxRecoveryResult> {
  const eventIds = await dependencies.findCandidates(
    normalizeLimit(requestedLimit),
  );
  const result: WhatsappInboxRecoveryResult = {
    candidateCount: eventIds.length,
    processedCount: 0,
    unavailableCount: 0,
    failedCount: 0,
  };

  for (const eventId of eventIds) {
    try {
      const processorResult = await dependencies.processEvent(eventId);

      if (processorResult.outcome === "processed") {
        result.processedCount += 1;
      } else if (processorResult.outcome === "unavailable") {
        result.unavailableCount += 1;
      } else {
        result.failedCount += 1;
      }
    } catch {
      result.failedCount += 1;
    }
  }

  return result;
}
