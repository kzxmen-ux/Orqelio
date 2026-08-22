const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WhatsappOutboundMessagePersistenceInput = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  providerMessageId: string;
  textContent: string;
};

export type WhatsappOutboundMessageStoreResult = {
  outcome: "accepted" | "duplicate";
  messageId: string;
};

export type WhatsappOutboundMessageRpcResult = {
  data: unknown;
  error: unknown;
};

export type WhatsappOutboundMessageRpc = (
  input: WhatsappOutboundMessagePersistenceInput,
) => Promise<WhatsappOutboundMessageRpcResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBoundedTrimmedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function validateInput(
  input: unknown,
): WhatsappOutboundMessagePersistenceInput | null {
  if (
    !isRecord(input) ||
    !isUuid(input.organizationId) ||
    !isUuid(input.connectionId) ||
    !isUuid(input.conversationId) ||
    !isBoundedTrimmedString(input.providerMessageId, 255) ||
    typeof input.textContent !== "string" ||
    input.textContent.trim().length === 0
  ) {
    return null;
  }

  return {
    connectionId: input.connectionId,
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    providerMessageId: input.providerMessageId,
    textContent: input.textContent,
  };
}

function normalizeResult(data: unknown): WhatsappOutboundMessageStoreResult | null {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return null;
  }

  const row = data[0];

  if (
    (row.outcome !== "accepted" && row.outcome !== "duplicate") ||
    !isUuid(row.message_id)
  ) {
    return null;
  }

  return {
    messageId: row.message_id,
    outcome: row.outcome,
  };
}

function storageFailure(): Error {
  return new Error("WhatsApp outbound message storage failed.");
}

export async function storeWhatsappOutboundMessageWithRpc(
  input: unknown,
  rpc: WhatsappOutboundMessageRpc,
): Promise<WhatsappOutboundMessageStoreResult> {
  const validatedInput = validateInput(input);

  if (!validatedInput) {
    throw new Error("Invalid WhatsApp outbound message persistence input.");
  }

  let rpcResult: WhatsappOutboundMessageRpcResult;

  try {
    rpcResult = await rpc(validatedInput);
  } catch {
    throw storageFailure();
  }

  if (rpcResult.error) {
    throw storageFailure();
  }

  const result = normalizeResult(rpcResult.data);

  if (!result) {
    throw storageFailure();
  }

  return result;
}
