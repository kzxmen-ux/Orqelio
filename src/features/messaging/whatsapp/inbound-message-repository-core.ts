import type { RoutedWhatsappInboundMessage } from "./inbound-routing-core.ts";

const PROVIDER_IDENTIFIER_PATTERN = /^[0-9]{1,32}$/;
const UNIX_SECONDS_PATTERN = /^[0-9]+$/;

export type WhatsappInboundPersistenceInput = {
  organizationId: string;
  connectionId: string;
  wabaId: string;
  phoneNumberId: string;
  externalParticipantId: string;
  displayName: string | null;
  providerMessageId: string;
  senderExternalId: string;
  messageType: string;
  textContent: string | null;
  providerTimestamp: string;
};

export type WhatsappInboundStoreResult = {
  outcome: "accepted" | "duplicate";
  conversationId: string;
  messageId: string;
};

export type WhatsappInboundRpcResult = {
  data: unknown;
  error: unknown;
};

export type WhatsappInboundRpc = (
  input: WhatsappInboundPersistenceInput,
) => Promise<WhatsappInboundRpcResult>;

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function isProviderIdentifier(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_IDENTIFIER_PATTERN.test(value);
}

function unixSecondsToIso(timestamp: unknown): string | null {
  if (
    typeof timestamp !== "string" ||
    !UNIX_SECONDS_PATTERN.test(timestamp)
  ) {
    return null;
  }

  const seconds = Number(timestamp);

  if (!Number.isSafeInteger(seconds)) {
    return null;
  }

  const milliseconds = seconds * 1000;
  const date = new Date(milliseconds);

  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function prepareWhatsappInboundPersistenceInput(
  message: RoutedWhatsappInboundMessage,
): WhatsappInboundPersistenceInput | null {
  const externalParticipantId = message.customerWaId ?? message.from;
  const providerTimestamp = unixSecondsToIso(message.timestamp);

  if (
    !isNonEmptyString(message.organizationId, 255) ||
    !isNonEmptyString(message.connectionId, 255) ||
    !isNonEmptyString(message.messageId, 255) ||
    !isProviderIdentifier(message.wabaId) ||
    !isProviderIdentifier(message.phoneNumberId) ||
    !isProviderIdentifier(message.from) ||
    !isProviderIdentifier(externalParticipantId) ||
    !isNonEmptyString(message.type, 64) ||
    providerTimestamp === null ||
    (message.customerName !== null &&
      (typeof message.customerName !== "string" ||
        message.customerName.length > 256)) ||
    (message.type === "text" && typeof message.text !== "string")
  ) {
    return null;
  }

  return {
    connectionId: message.connectionId,
    displayName: message.customerName,
    externalParticipantId,
    messageType: message.type,
    organizationId: message.organizationId,
    phoneNumberId: message.phoneNumberId,
    providerMessageId: message.messageId,
    providerTimestamp,
    senderExternalId: message.from,
    textContent: message.type === "text" ? message.text : null,
    wabaId: message.wabaId,
  };
}

function normalizeRpcResult(data: unknown): WhatsappInboundStoreResult | null {
  if (!Array.isArray(data) || data.length !== 1) {
    return null;
  }

  const row = data[0];

  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }

  if (
    (row.outcome !== "accepted" && row.outcome !== "duplicate") ||
    !isNonEmptyString(row.conversation_id, 255) ||
    !isNonEmptyString(row.message_id, 255)
  ) {
    return null;
  }

  return {
    conversationId: row.conversation_id,
    messageId: row.message_id,
    outcome: row.outcome,
  };
}

export async function storeRoutedWhatsappInboundMessageWithRpc(
  message: RoutedWhatsappInboundMessage,
  rpc: WhatsappInboundRpc,
): Promise<WhatsappInboundStoreResult> {
  const input = prepareWhatsappInboundPersistenceInput(message);

  if (!input) {
    throw new Error("Invalid WhatsApp inbound message.");
  }

  let rpcResult: WhatsappInboundRpcResult;

  try {
    rpcResult = await rpc(input);
  } catch {
    throw new Error("WhatsApp inbound message storage failed.");
  }

  if (rpcResult.error) {
    throw new Error("WhatsApp inbound message storage failed.");
  }

  const result = normalizeRpcResult(rpcResult.data);

  if (!result) {
    throw new Error("WhatsApp inbound message storage failed.");
  }

  return result;
}
