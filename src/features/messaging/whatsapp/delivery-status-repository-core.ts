import type { WhatsappDeliveryStatus } from "../../webhooks/whatsapp/normalize.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_MESSAGE_ID_MAX_LENGTH = 255;
const SAFE_ERROR_MESSAGE =
  "WhatsApp delivery status repository operation failed.";

export type WhatsappDeliveryStatusPersistenceInput = {
  organizationId: string;
  connectionId: string;
  providerMessageId: string;
  status: WhatsappDeliveryStatus;
  providerTimestamp: string;
};

export type WhatsappDeliveryStatusPersistenceResult = {
  outcome: "updated" | "duplicate";
  messageId: string;
  deliveryStatus: "accepted" | WhatsappDeliveryStatus;
};

type RpcResult = {
  data: unknown;
  error: unknown;
};

export type WhatsappDeliveryStatusRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeliveryStatus(
  value: unknown,
): value is WhatsappDeliveryStatusPersistenceResult["deliveryStatus"] {
  return (
    value === "accepted" ||
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed"
  );
}

function isInputStatus(value: unknown): value is WhatsappDeliveryStatus {
  return (
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed"
  );
}

function validateInput(
  input: WhatsappDeliveryStatusPersistenceInput,
): WhatsappDeliveryStatusPersistenceInput {
  if (
    !isRecord(input) ||
    typeof input.organizationId !== "string" ||
    !UUID_PATTERN.test(input.organizationId) ||
    typeof input.connectionId !== "string" ||
    !UUID_PATTERN.test(input.connectionId) ||
    typeof input.providerMessageId !== "string" ||
    input.providerMessageId.length === 0 ||
    input.providerMessageId.length > PROVIDER_MESSAGE_ID_MAX_LENGTH ||
    input.providerMessageId !== input.providerMessageId.trim() ||
    !isInputStatus(input.status) ||
    typeof input.providerTimestamp !== "string" ||
    !Number.isFinite(Date.parse(input.providerTimestamp))
  ) {
    throw new Error(SAFE_ERROR_MESSAGE);
  }

  return input;
}

function normalizeResult(
  data: unknown,
): WhatsappDeliveryStatusPersistenceResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new Error(SAFE_ERROR_MESSAGE);
  }

  const row = data[0];

  if (
    (row.outcome !== "updated" && row.outcome !== "duplicate") ||
    typeof row.message_id !== "string" ||
    !UUID_PATTERN.test(row.message_id) ||
    !isDeliveryStatus(row.delivery_status)
  ) {
    throw new Error(SAFE_ERROR_MESSAGE);
  }

  return {
    deliveryStatus: row.delivery_status,
    messageId: row.message_id,
    outcome: row.outcome,
  };
}

export async function applyWhatsappDeliveryStatusWithRpc(
  input: WhatsappDeliveryStatusPersistenceInput,
  rpc: WhatsappDeliveryStatusRpc,
): Promise<WhatsappDeliveryStatusPersistenceResult> {
  const validatedInput = validateInput(input);

  try {
    const { data, error } = await rpc(
      "apply_whatsapp_outbound_delivery_status",
      {
        p_connection_id: validatedInput.connectionId,
        p_organization_id: validatedInput.organizationId,
        p_provider_message_id: validatedInput.providerMessageId,
        p_provider_status: validatedInput.status,
        p_provider_timestamp: validatedInput.providerTimestamp,
      },
    );

    if (error !== null) {
      throw new Error(SAFE_ERROR_MESSAGE);
    }

    return normalizeResult(data);
  } catch {
    throw new Error(SAFE_ERROR_MESSAGE);
  }
}
