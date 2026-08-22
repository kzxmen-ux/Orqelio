const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_IDENTIFIER_PATTERN = /^[0-9]{1,32}$/;

const INVALID_REQUEST_MESSAGE = "Invalid WhatsApp outbound request";
const UNAVAILABLE_CONVERSATION_MESSAGE =
  "WhatsApp outbound conversation is unavailable";
const SERVICE_ERROR_MESSAGE = "WhatsApp outbound conversation service failed";
const INDETERMINATE_ERROR_MESSAGE =
  "WhatsApp outbound send outcome is indeterminate; do not resend automatically";
const DATABASE_RETRY_ATTEMPTS = 3;

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

export type WhatsappDurableOutboundConversationResult =
  | {
      outcome: "persisted";
      providerMessageId: string;
      messageId: string;
      persistenceOutcome: "accepted" | "duplicate";
    }
  | {
      outcome: "recovery_required";
      dispatchId: string;
      providerMessageId: string;
    };

export type RecoverWhatsappOutboundDispatchInput = {
  organizationId: string;
  dispatchId: string;
  providerMessageId: string;
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

type DispatchState =
  | "prepared"
  | "dispatching"
  | "provider_accepted"
  | "persisted"
  | "indeterminate";

type DispatchResult = {
  dispatchId: string;
  state: DispatchState;
};

type PreparedDispatchResult = {
  dispatchId: string;
};

type DispatchRecoveryState = DispatchResult & {
  providerMessageId: string | null;
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

export type WhatsappDurableOutboundConversationDependencies = {
  lookupConversation: WhatsappOutboundConversationDependencies["lookupConversation"];
  prepareDispatch: (input: {
    organizationId: string;
    connectionId: string;
    conversationId: string;
    textContent: string;
  }) => Promise<PreparedDispatchResult>;
  markDispatching: (input: {
    organizationId: string;
    dispatchId: string;
  }) => Promise<DispatchResult>;
  sendTextMessage: WhatsappOutboundConversationDependencies["sendTextMessage"];
  recordProviderAcceptance: (input: {
    organizationId: string;
    dispatchId: string;
    providerMessageId: string;
  }) => Promise<DispatchResult>;
  finalizeDispatch: (input: {
    organizationId: string;
    dispatchId: string;
  }) => Promise<PersistenceResult>;
  markIndeterminate: (input: {
    organizationId: string;
    dispatchId: string;
  }) => Promise<DispatchResult>;
  waitBeforeRetry?: (attempt: number) => Promise<void>;
};

export type WhatsappOutboundRecoveryDependencies = Pick<
  WhatsappDurableOutboundConversationDependencies,
  "recordProviderAcceptance" | "finalizeDispatch" | "waitBeforeRetry"
> & {
  getRecoveryState: (input: {
    organizationId: string;
    dispatchId: string;
  }) => Promise<DispatchRecoveryState>;
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

function isProviderMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    value === value.trim()
  );
}

function validateRecoveryInput(
  input: RecoverWhatsappOutboundDispatchInput,
): RecoverWhatsappOutboundDispatchInput {
  if (
    !isRecord(input) ||
    typeof input.organizationId !== "string" ||
    !UUID_PATTERN.test(input.organizationId) ||
    typeof input.dispatchId !== "string" ||
    !UUID_PATTERN.test(input.dispatchId) ||
    !isProviderMessageId(input.providerMessageId)
  ) {
    throw new Error(INVALID_REQUEST_MESSAGE);
  }

  return input;
}

async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  waitBeforeRetry?: (attempt: number) => Promise<void>,
): Promise<T> {
  let lastFailure: unknown;

  for (let attempt = 1; attempt <= DATABASE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastFailure = error;

      if (attempt < DATABASE_RETRY_ATTEMPTS && waitBeforeRetry) {
        await waitBeforeRetry(attempt);
      }
    }
  }

  throw lastFailure;
}

export class WhatsappOutboundIndeterminateError extends Error {
  readonly code = "WHATSAPP_OUTBOUND_INDETERMINATE";

  constructor() {
    super(INDETERMINATE_ERROR_MESSAGE);
    this.name = "WhatsappOutboundIndeterminateError";
  }
}

export async function sendWhatsappConversationTextDurablyWithDependencies(
  input: WhatsappOutboundConversationInput,
  dependencies: WhatsappDurableOutboundConversationDependencies,
): Promise<WhatsappDurableOutboundConversationResult> {
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

  let preparedDispatch: PreparedDispatchResult;

  try {
    preparedDispatch = await dependencies.prepareDispatch({
      organizationId: validatedInput.organizationId,
      connectionId: resolvedConversation.connectionId,
      conversationId: validatedInput.conversationId,
      textContent: validatedInput.text,
    });

    const dispatching = await dependencies.markDispatching({
      organizationId: validatedInput.organizationId,
      dispatchId: preparedDispatch.dispatchId,
    });

    if (
      dispatching.dispatchId !== preparedDispatch.dispatchId ||
      dispatching.state !== "dispatching"
    ) {
      throw new Error(SERVICE_ERROR_MESSAGE);
    }
  } catch {
    throw new Error(SERVICE_ERROR_MESSAGE);
  }

  let sendResult: SendResult;

  try {
    sendResult = await dependencies.sendTextMessage({
      phoneNumberId: resolvedConversation.phoneNumberId,
      recipientWaId: resolvedConversation.recipientWaId,
      text: validatedInput.text,
    });

    if (!isProviderMessageId(sendResult.providerMessageId)) {
      throw new Error(SERVICE_ERROR_MESSAGE);
    }
  } catch {
    try {
      await dependencies.markIndeterminate({
        organizationId: validatedInput.organizationId,
        dispatchId: preparedDispatch.dispatchId,
      });
    } catch {
      // Best effort only: the safe error still forbids automatic resend.
    }

    throw new WhatsappOutboundIndeterminateError();
  }

  const recoveryResult = {
    dispatchId: preparedDispatch.dispatchId,
    outcome: "recovery_required" as const,
    providerMessageId: sendResult.providerMessageId,
  };

  try {
    await retryDatabaseOperation(async () => {
      const recorded = await dependencies.recordProviderAcceptance({
          organizationId: validatedInput.organizationId,
          dispatchId: preparedDispatch.dispatchId,
          providerMessageId: sendResult.providerMessageId,
        });

      if (
        recorded.dispatchId !== preparedDispatch.dispatchId ||
        (recorded.state !== "provider_accepted" &&
          recorded.state !== "persisted")
      ) {
        throw new Error(SERVICE_ERROR_MESSAGE);
      }

      return recorded;
    }, dependencies.waitBeforeRetry);
  } catch {
    return recoveryResult;
  }

  try {
    const persisted = await retryDatabaseOperation(
      () =>
        dependencies.finalizeDispatch({
          organizationId: validatedInput.organizationId,
          dispatchId: preparedDispatch.dispatchId,
        }),
      dependencies.waitBeforeRetry,
    );

    return {
      messageId: persisted.messageId,
      outcome: "persisted",
      persistenceOutcome: persisted.outcome,
      providerMessageId: sendResult.providerMessageId,
    };
  } catch {
    return recoveryResult;
  }
}

export async function recoverWhatsappOutboundDispatchWithDependencies(
  input: RecoverWhatsappOutboundDispatchInput,
  dependencies: WhatsappOutboundRecoveryDependencies,
): Promise<WhatsappDurableOutboundConversationResult> {
  const validatedInput = validateRecoveryInput(input);
  const recoveryResult = {
    dispatchId: validatedInput.dispatchId,
    outcome: "recovery_required" as const,
    providerMessageId: validatedInput.providerMessageId,
  };

  try {
    const current = await dependencies.getRecoveryState({
      dispatchId: validatedInput.dispatchId,
      organizationId: validatedInput.organizationId,
    });

    if (current.dispatchId !== validatedInput.dispatchId) {
      return recoveryResult;
    }

    if (current.state === "dispatching") {
      await retryDatabaseOperation(async () => {
        const recorded =
          await dependencies.recordProviderAcceptance(validatedInput);

        if (
          recorded.dispatchId !== validatedInput.dispatchId ||
          (recorded.state !== "provider_accepted" &&
            recorded.state !== "persisted")
        ) {
          throw new Error(SERVICE_ERROR_MESSAGE);
        }

        return recorded;
      }, dependencies.waitBeforeRetry);
    } else if (
      (current.state !== "provider_accepted" && current.state !== "persisted") ||
      current.providerMessageId !== validatedInput.providerMessageId
    ) {
      return recoveryResult;
    }

    const persisted = await retryDatabaseOperation(
      () =>
        dependencies.finalizeDispatch({
          organizationId: validatedInput.organizationId,
          dispatchId: validatedInput.dispatchId,
        }),
      dependencies.waitBeforeRetry,
    );

    return {
      messageId: persisted.messageId,
      outcome: "persisted",
      persistenceOutcome: persisted.outcome,
      providerMessageId: validatedInput.providerMessageId,
    };
  } catch {
    return recoveryResult;
  }
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
