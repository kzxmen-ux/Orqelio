const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_ROUTING_IDENTIFIER_PATTERN = /^[0-9]{1,64}$/;
const AI_REPLY_TEXT_MAX_LENGTH = 2_000;
const PROVIDER_MESSAGE_ID_MAX_LENGTH = 255;
const SAFE_ERROR_MESSAGE =
  "WhatsApp outbound dispatch repository operation failed.";

type RpcResult = {
  data: unknown;
  error: unknown;
};

export type WhatsappOutboundDispatchRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResult>;

export type PrepareWhatsappOutboundDispatchInput = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  textContent: string;
};

export type PrepareAiReplyWhatsappDispatchInput = {
  organizationId: string;
  aiMessageRunId: string;
};

export type ClaimAiReplyWhatsappDispatchExecutionInput = {
  organizationId: string;
  aiMessageRunId: string;
};

export type ClaimAiReplyWhatsappDispatchExecutionResult =
  | {
      outcome: "claimed";
      dispatchId: string;
      phoneNumberId: string;
      recipientWaId: string;
      text: string;
    }
  | {
      outcome:
        | "already_dispatching"
        | "provider_accepted"
        | "persisted"
        | "indeterminate";
      dispatchId: string;
    };

export type WhatsappOutboundDispatchIdentity = {
  organizationId: string;
  dispatchId: string;
};

export type RecordWhatsappProviderAcceptanceInput =
  WhatsappOutboundDispatchIdentity & {
    providerMessageId: string;
  };

export type WhatsappOutboundDispatchState =
  | "prepared"
  | "dispatching"
  | "provider_accepted"
  | "persisted"
  | "indeterminate";

export type WhatsappOutboundDispatchResult = {
  dispatchId: string;
  state: WhatsappOutboundDispatchState;
};

export type PreparedWhatsappOutboundDispatchResult = {
  dispatchId: string;
};

export type WhatsappOutboundDispatchRecoveryState =
  WhatsappOutboundDispatchResult & {
    providerMessageId: string | null;
  };

export type WhatsappOutboundDispatchFinalizationResult = {
  outcome: "accepted" | "duplicate";
  messageId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isProviderMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= PROVIDER_MESSAGE_ID_MAX_LENGTH &&
    value === value.trim()
  );
}

function isState(value: unknown): value is WhatsappOutboundDispatchState {
  return (
    value === "prepared" ||
    value === "dispatching" ||
    value === "provider_accepted" ||
    value === "persisted" ||
    value === "indeterminate"
  );
}

function repositoryFailure(): Error {
  return new Error(SAFE_ERROR_MESSAGE);
}

function normalizeDispatchResult(data: unknown): WhatsappOutboundDispatchResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw repositoryFailure();
  }

  const row = data[0];

  if (!isUuid(row.dispatch_id) || !isState(row.state)) {
    throw repositoryFailure();
  }

  return { dispatchId: row.dispatch_id, state: row.state };
}

function normalizePreparedDispatchResult(
  data: unknown,
): PreparedWhatsappOutboundDispatchResult {
  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    !isRecord(data[0]) ||
    !isUuid(data[0].dispatch_id)
  ) {
    throw repositoryFailure();
  }

  return { dispatchId: data[0].dispatch_id };
}

function normalizeAiReplyExecutionClaimResult(
  data: unknown,
): ClaimAiReplyWhatsappDispatchExecutionResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw repositoryFailure();
  }

  const row = data[0];

  if (!isUuid(row.dispatch_id)) {
    throw repositoryFailure();
  }

  if (row.outcome === "claimed") {
    if (
      typeof row.phone_number_id !== "string" ||
      !META_ROUTING_IDENTIFIER_PATTERN.test(row.phone_number_id) ||
      typeof row.recipient_wa_id !== "string" ||
      !META_ROUTING_IDENTIFIER_PATTERN.test(row.recipient_wa_id) ||
      typeof row.text !== "string" ||
      row.text.length < 1 ||
      row.text.length > AI_REPLY_TEXT_MAX_LENGTH ||
      row.text !== row.text.trim()
    ) {
      throw repositoryFailure();
    }

    return {
      outcome: "claimed",
      dispatchId: row.dispatch_id,
      phoneNumberId: row.phone_number_id,
      recipientWaId: row.recipient_wa_id,
      text: row.text,
    };
  }

  if (
    (row.outcome !== "already_dispatching" &&
      row.outcome !== "provider_accepted" &&
      row.outcome !== "persisted" &&
      row.outcome !== "indeterminate") ||
    row.phone_number_id !== null ||
    row.recipient_wa_id !== null ||
    row.text !== null
  ) {
    throw repositoryFailure();
  }

  return {
    outcome: row.outcome,
    dispatchId: row.dispatch_id,
  };
}

function normalizeRecoveryState(
  data: unknown,
): WhatsappOutboundDispatchRecoveryState {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw repositoryFailure();
  }

  const row = data[0];

  if (
    !isUuid(row.dispatch_id) ||
    !isState(row.state) ||
    (row.provider_message_id !== null &&
      !isProviderMessageId(row.provider_message_id))
  ) {
    throw repositoryFailure();
  }

  return {
    dispatchId: row.dispatch_id,
    providerMessageId: row.provider_message_id,
    state: row.state,
  };
}

function normalizeFinalizationResult(
  data: unknown,
): WhatsappOutboundDispatchFinalizationResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw repositoryFailure();
  }

  const row = data[0];

  if (
    (row.outcome !== "accepted" && row.outcome !== "duplicate") ||
    !isUuid(row.message_id)
  ) {
    throw repositoryFailure();
  }

  return { messageId: row.message_id, outcome: row.outcome };
}

async function callRpc<T>(
  rpc: WhatsappOutboundDispatchRpc,
  functionName: string,
  parameters: Record<string, unknown>,
  normalize: (data: unknown) => T,
): Promise<T> {
  try {
    const { data, error } = await rpc(functionName, parameters);

    if (error !== null) {
      throw repositoryFailure();
    }

    return normalize(data);
  } catch {
    throw repositoryFailure();
  }
}

function validateIdentity(input: unknown): WhatsappOutboundDispatchIdentity {
  if (
    !isRecord(input) ||
    !isUuid(input.organizationId) ||
    !isUuid(input.dispatchId)
  ) {
    throw repositoryFailure();
  }

  return {
    dispatchId: input.dispatchId,
    organizationId: input.organizationId,
  };
}

export function prepareWhatsappOutboundDispatchWithRpc(
  input: PrepareWhatsappOutboundDispatchInput,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<PreparedWhatsappOutboundDispatchResult> {
  if (
    !isRecord(input) ||
    !isUuid(input.organizationId) ||
    !isUuid(input.connectionId) ||
    !isUuid(input.conversationId) ||
    typeof input.textContent !== "string" ||
    input.textContent.trim().length === 0
  ) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "prepare_whatsapp_outbound_dispatch",
    {
      p_connection_id: input.connectionId,
      p_conversation_id: input.conversationId,
      p_organization_id: input.organizationId,
      p_text_content: input.textContent,
    },
    normalizePreparedDispatchResult,
  );
}

export function prepareAiReplyWhatsappDispatchWithRpc(
  input: PrepareAiReplyWhatsappDispatchInput,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchResult> {
  if (
    !isRecord(input) ||
    !isUuid(input.organizationId) ||
    !isUuid(input.aiMessageRunId)
  ) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "prepare_ai_reply_whatsapp_dispatch",
    {
      p_ai_message_run_id: input.aiMessageRunId,
      p_organization_id: input.organizationId,
    },
    normalizeDispatchResult,
  );
}

export function claimAiReplyWhatsappDispatchExecutionWithRpc(
  input: ClaimAiReplyWhatsappDispatchExecutionInput,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<ClaimAiReplyWhatsappDispatchExecutionResult> {
  if (
    !isRecord(input) ||
    !isUuid(input.organizationId) ||
    !isUuid(input.aiMessageRunId)
  ) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "claim_ai_reply_whatsapp_dispatch_execution",
    {
      p_ai_message_run_id: input.aiMessageRunId,
      p_organization_id: input.organizationId,
    },
    normalizeAiReplyExecutionClaimResult,
  );
}

export function getWhatsappOutboundDispatchRecoveryStateWithRpc(
  input: WhatsappOutboundDispatchIdentity,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchRecoveryState> {
  const validated = validateIdentity(input);
  return callRpc(
    rpc,
    "get_whatsapp_outbound_dispatch_recovery_state",
    {
      p_dispatch_id: validated.dispatchId,
      p_organization_id: validated.organizationId,
    },
    normalizeRecoveryState,
  );
}

export function markWhatsappOutboundDispatchingWithRpc(
  input: WhatsappOutboundDispatchIdentity,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchResult> {
  const validated = validateIdentity(input);
  return callRpc(
    rpc,
    "mark_whatsapp_outbound_dispatching",
    {
      p_dispatch_id: validated.dispatchId,
      p_organization_id: validated.organizationId,
    },
    normalizeDispatchResult,
  );
}

export function recordWhatsappOutboundProviderAcceptanceWithRpc(
  input: RecordWhatsappProviderAcceptanceInput,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchResult> {
  const validated = validateIdentity(input);

  if (!isProviderMessageId(input.providerMessageId)) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "record_whatsapp_outbound_provider_acceptance",
    {
      p_dispatch_id: validated.dispatchId,
      p_organization_id: validated.organizationId,
      p_provider_message_id: input.providerMessageId,
    },
    normalizeDispatchResult,
  );
}

export function markWhatsappOutboundDispatchIndeterminateWithRpc(
  input: WhatsappOutboundDispatchIdentity,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchResult> {
  const validated = validateIdentity(input);
  return callRpc(
    rpc,
    "mark_whatsapp_outbound_dispatch_indeterminate",
    {
      p_dispatch_id: validated.dispatchId,
      p_organization_id: validated.organizationId,
    },
    normalizeDispatchResult,
  );
}

export function finalizeWhatsappOutboundDispatchWithRpc(
  input: WhatsappOutboundDispatchIdentity,
  rpc: WhatsappOutboundDispatchRpc,
): Promise<WhatsappOutboundDispatchFinalizationResult> {
  const validated = validateIdentity(input);
  return callRpc(
    rpc,
    "finalize_whatsapp_outbound_dispatch",
    {
      p_dispatch_id: validated.dispatchId,
      p_organization_id: validated.organizationId,
    },
    normalizeFinalizationResult,
  );
}
