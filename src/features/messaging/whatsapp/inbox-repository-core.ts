export type WhatsappInboxClaimResult =
  | {
      outcome: "claimed";
      eventId: string;
      rawPayload: Record<string, unknown>;
    }
  | {
      outcome: "unavailable";
      eventId: string;
      rawPayload: null;
    };

export type WhatsappInboxCompletionResult = {
  outcome: "completed";
  eventId: string;
};

export type WhatsappInboxFailureResult = {
  outcome: "failed";
  eventId: string;
};

type RpcResponse = {
  data: unknown;
  error: unknown;
};

export type WhatsappInboxRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResponse>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertEventId(eventId: string): void {
  if (!UUID_PATTERN.test(eventId)) {
    throw new Error("Invalid WhatsApp inbox event ID.");
  }
}

function assertErrorCode(errorCode: string): void {
  if (
    errorCode.length < 1 ||
    errorCode.length > 64 ||
    errorCode.trim() !== errorCode ||
    !SAFE_ERROR_CODE_PATTERN.test(errorCode)
  ) {
    throw new Error("Invalid WhatsApp inbox error code.");
  }
}

function repositoryFailure(): Error {
  return new Error("WhatsApp inbox repository operation failed.");
}

async function callRpc(
  rpc: WhatsappInboxRpc,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: RpcResponse;

  try {
    response = await rpc(functionName, parameters);
  } catch {
    throw repositoryFailure();
  }

  if (response.error !== null && response.error !== undefined) {
    throw repositoryFailure();
  }

  if (
    !Array.isArray(response.data) ||
    response.data.length !== 1 ||
    !isRecord(response.data[0])
  ) {
    throw repositoryFailure();
  }

  return response.data[0];
}

function requireMatchingEventId(
  row: Record<string, unknown>,
  eventId: string,
): void {
  if (row.event_id !== eventId) {
    throw repositoryFailure();
  }
}

export function createWhatsappInboxRepository(rpc: WhatsappInboxRpc) {
  return {
    async claimWhatsappWebhookEvent(
      eventId: string,
    ): Promise<WhatsappInboxClaimResult> {
      assertEventId(eventId);

      const row = await callRpc(rpc, "claim_whatsapp_webhook_event", {
        p_event_id: eventId,
      });
      requireMatchingEventId(row, eventId);

      if (row.outcome === "unavailable" && row.raw_payload === null) {
        return {
          outcome: "unavailable",
          eventId,
          rawPayload: null,
        };
      }

      if (row.outcome === "claimed" && isRecord(row.raw_payload)) {
        return {
          outcome: "claimed",
          eventId,
          rawPayload: row.raw_payload,
        };
      }

      throw repositoryFailure();
    },

    async completeWhatsappWebhookEvent(
      eventId: string,
    ): Promise<WhatsappInboxCompletionResult> {
      assertEventId(eventId);

      const row = await callRpc(rpc, "complete_whatsapp_webhook_event", {
        p_event_id: eventId,
      });
      requireMatchingEventId(row, eventId);

      if (row.outcome !== "completed") {
        throw repositoryFailure();
      }

      return { outcome: "completed", eventId };
    },

    async failWhatsappWebhookEvent(
      eventId: string,
      errorCode: string,
    ): Promise<WhatsappInboxFailureResult> {
      assertEventId(eventId);
      assertErrorCode(errorCode);

      const row = await callRpc(rpc, "fail_whatsapp_webhook_event", {
        p_event_id: eventId,
        p_error_code: errorCode,
      });
      requireMatchingEventId(row, eventId);

      if (row.outcome !== "failed") {
        throw repositoryFailure();
      }

      return { outcome: "failed", eventId };
    },
  };
}
