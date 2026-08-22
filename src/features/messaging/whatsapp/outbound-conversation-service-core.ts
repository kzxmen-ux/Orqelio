const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_IDENTIFIER_PATTERN = /^[0-9]{1,32}$/;

const INVALID_REQUEST_MESSAGE = "Invalid WhatsApp outbound request";
const UNAVAILABLE_CONVERSATION_MESSAGE =
  "WhatsApp outbound conversation is unavailable";
const SERVICE_ERROR_MESSAGE = "WhatsApp outbound conversation service failed";

export type WhatsappOutboundConversationInput = {
  organizationId: string;
  conversationId: string;
  text: string;
};

export type WhatsappOutboundConversationResult = {
  providerMessageId: string;
  messageId: string;
  persistenceOutcome: "accepted" | "duplicate";
};

type ValidatedInput = WhatsappOutboundConversationInput;

type ConversationLookupResult = {
  data: unknown;
  error: unknown;
};

type SendResult = {
  providerMessageId: string;
};

type PersistenceResult = {
  outcome: "accepted" | "duplicate";
  messageId: string;
};

export type WhatsappOutboundConversationDependencies = {
  lookupConversation: (
    input: Pick<ValidatedInput, "organizationId" | "conversationId">,
  ) => Promise<ConversationLookupResult>;
  sendTextMessage: (input: {
    phoneNumberId: string;
    recipientWaId: string;
    text: string;
  }) => Promise<SendResult>;
  storeOutboundMessage: (input: {
    organizationId: string;
    connectionId: string;
    conversationId: string;
    providerMessageId: string;
    textContent: string;
  }) => Promise<PersistenceResult>;
};

type ResolvedConversation = {
  connectionId: string;
  phoneNumberId: string;
  recipientWaId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validateInput(input: WhatsappOutboundConversationInput): ValidatedInput {
  if (
    !isRecord(input) ||
    typeof input.organizationId !== "string" ||
    !UUID_PATTERN.test(input.organizationId) ||
    typeof input.conversationId !== "string" ||
    !UUID_PATTERN.test(input.conversationId) ||
    typeof input.text !== "string" ||
    input.text.trim().length === 0
  ) {
    throw new Error(INVALID_REQUEST_MESSAGE);
  }

  return input;
}

function resolveConversation(
  data: unknown,
  input: ValidatedInput,
): ResolvedConversation {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw new Error(UNAVAILABLE_CONVERSATION_MESSAGE);
  }

  const conversation = data[0];
  const connection = conversation.connection;
  const recipientWaId = conversation.external_participant_id;

  if (
    conversation.id !== input.conversationId ||
    conversation.organization_id !== input.organizationId ||
    conversation.channel !== "whatsapp" ||
    typeof recipientWaId !== "string" ||
    !DECIMAL_IDENTIFIER_PATTERN.test(recipientWaId) ||
    !isRecord(connection)
  ) {
    throw new Error(UNAVAILABLE_CONVERSATION_MESSAGE);
  }

  const phoneNumberId = connection.phone_number_id;

  if (
    typeof connection.id !== "string" ||
    !UUID_PATTERN.test(connection.id) ||
    connection.organization_id !== input.organizationId ||
    connection.status !== "active" ||
    typeof phoneNumberId !== "string" ||
    !DECIMAL_IDENTIFIER_PATTERN.test(phoneNumberId)
  ) {
    throw new Error(UNAVAILABLE_CONVERSATION_MESSAGE);
  }

  return {
    connectionId: connection.id,
    phoneNumberId,
    recipientWaId,
  };
}

export async function sendWhatsappConversationTextWithDependencies(
  input: WhatsappOutboundConversationInput,
  dependencies: WhatsappOutboundConversationDependencies,
): Promise<WhatsappOutboundConversationResult> {
  const validatedInput = validateInput(input);

  let lookupResult: ConversationLookupResult;

  try {
    lookupResult = await dependencies.lookupConversation({
      organizationId: validatedInput.organizationId,
      conversationId: validatedInput.conversationId,
    });
  } catch {
    throw new Error(SERVICE_ERROR_MESSAGE);
  }

  if (lookupResult.error !== null) {
    throw new Error(SERVICE_ERROR_MESSAGE);
  }

  const resolvedConversation = resolveConversation(
    lookupResult.data,
    validatedInput,
  );

  let sendResult: SendResult;

  try {
    sendResult = await dependencies.sendTextMessage({
      phoneNumberId: resolvedConversation.phoneNumberId,
      recipientWaId: resolvedConversation.recipientWaId,
      text: validatedInput.text,
    });
  } catch {
    throw new Error(SERVICE_ERROR_MESSAGE);
  }

  let persistenceResult: PersistenceResult;

  try {
    persistenceResult = await dependencies.storeOutboundMessage({
      organizationId: validatedInput.organizationId,
      connectionId: resolvedConversation.connectionId,
      conversationId: validatedInput.conversationId,
      providerMessageId: sendResult.providerMessageId,
      textContent: validatedInput.text,
    });
  } catch {
    throw new Error(SERVICE_ERROR_MESSAGE);
  }

  return {
    providerMessageId: sendResult.providerMessageId,
    messageId: persistenceResult.messageId,
    persistenceOutcome: persistenceResult.outcome,
  };
}
