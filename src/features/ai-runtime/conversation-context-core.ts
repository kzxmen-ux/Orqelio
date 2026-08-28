import type {
  AiManagerCommunicationStyle,
  AiManagerConfiguration,
  AiManagerFormality,
  AiManagerPrimaryLanguage,
} from "../ai-manager-settings/types.ts";
import { buildHandoffPolicy } from "../handoff-policy/policy.ts";
import type { HandoffPolicy } from "../handoff-policy/types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTEXT_MESSAGES = 30;
const MAX_CONTEXT_CHARACTERS = 12_000;
const SAFE_ERROR_MESSAGE = "Conversation AI context could not be loaded.";

export type ConversationAiContextInput = {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
};

export type ConversationAiContextMessage = {
  role: "customer" | "assistant";
  text: string;
  createdAt: string;
  isCurrentTrigger: boolean;
};

export type ConversationAiContext = {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
  organization: {
    name: string;
  };
  aiManager: {
    primaryLanguage: AiManagerPrimaryLanguage;
    formality: AiManagerFormality;
    communicationStyle: AiManagerCommunicationStyle;
    businessContext: string;
    configurationVersion: number;
  };
  handoffPolicy: HandoffPolicy;
  messages: ConversationAiContextMessage[];
};

export type ConversationAiContextResult =
  | { outcome: "ready"; context: ConversationAiContext }
  | {
      outcome: "blocked";
      reason:
        | "ai_configuration_missing"
        | "ai_configuration_not_ready";
    };

type QueryResult = {
  data: unknown;
  error: unknown;
};

export type ConversationAiContextDependencies = {
  loadOrganization: (input: ConversationAiContextInput) => Promise<QueryResult>;
  loadConversation: (input: ConversationAiContextInput) => Promise<QueryResult>;
  loadTriggerMessage: (
    input: ConversationAiContextInput,
  ) => Promise<QueryResult>;
  loadAiManagerConfiguration: (
    input: ConversationAiContextInput,
  ) => Promise<QueryResult>;
  loadRecentMessages: (
    input: ConversationAiContextInput & { triggerCreatedAt: string },
  ) => Promise<QueryResult>;
};

type Organization = { id: string; name: string };
type TriggerMessage = {
  id: string;
  organizationId: string;
  conversationId: string;
  createdAt: string;
  text: string;
};
type RuntimeConfiguration = Pick<
  AiManagerConfiguration,
  | "communicationStyle"
  | "formality"
  | "handoff"
  | "organizationId"
  | "primaryLanguage"
  | "rawBusinessContext"
  | "status"
  | "version"
>;
type HistoryCandidate = ConversationAiContextMessage & {
  id: string;
  sourceIndex: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeError(): Error {
  return new Error(SAFE_ERROR_MESSAGE);
}

function validateInput(input: unknown): ConversationAiContextInput {
  if (
    !isRecord(input) ||
    typeof input.organizationId !== "string" ||
    !UUID_PATTERN.test(input.organizationId) ||
    typeof input.conversationId !== "string" ||
    !UUID_PATTERN.test(input.conversationId) ||
    typeof input.triggerMessageId !== "string" ||
    !UUID_PATTERN.test(input.triggerMessageId)
  ) {
    throw safeError();
  }

  return {
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    triggerMessageId: input.triggerMessageId,
  };
}

async function runQuery(
  query: () => Promise<QueryResult>,
): Promise<unknown> {
  try {
    const result = await query();
    if (!isRecord(result) || result.error !== null) throw safeError();
    return result.data;
  } catch {
    throw safeError();
  }
}

function oneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw safeError();
  }
  return data[0];
}

function mapOrganization(data: unknown, organizationId: string): Organization {
  const row = oneRow(data);
  if (
    row.id !== organizationId ||
    typeof row.name !== "string" ||
    row.name.trim().length === 0
  ) {
    throw safeError();
  }
  return { id: organizationId, name: row.name };
}

function validateConversation(
  data: unknown,
  input: ConversationAiContextInput,
): void {
  const row = oneRow(data);
  const connection = row.connection;

  if (
    row.id !== input.conversationId ||
    row.organization_id !== input.organizationId ||
    row.channel !== "whatsapp" ||
    !isRecord(connection) ||
    typeof connection.id !== "string" ||
    !UUID_PATTERN.test(connection.id) ||
    connection.organization_id !== input.organizationId ||
    connection.status !== "active"
  ) {
    throw safeError();
  }
}

function mapTriggerMessage(
  data: unknown,
  input: ConversationAiContextInput,
): TriggerMessage {
  const row = oneRow(data);

  if (
    row.id !== input.triggerMessageId ||
    row.organization_id !== input.organizationId ||
    row.conversation_id !== input.conversationId ||
    row.channel !== "whatsapp" ||
    row.direction !== "inbound" ||
    row.message_type !== "text" ||
    typeof row.text_content !== "string" ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at))
  ) {
    throw safeError();
  }

  return {
    conversationId: input.conversationId,
    createdAt: row.created_at,
    id: input.triggerMessageId,
    organizationId: input.organizationId,
    text: row.text_content,
  };
}

function isPrimaryLanguage(value: unknown): value is AiManagerPrimaryLanguage {
  return value === "kk" || value === "ru";
}

function isFormality(value: unknown): value is AiManagerFormality {
  return value === "formal" || value === "informal";
}

function isCommunicationStyle(
  value: unknown,
): value is AiManagerCommunicationStyle {
  return value === "formal" || value === "friendly" || value === "neutral";
}

function mapConfiguration(
  data: unknown,
  organizationId: string,
): RuntimeConfiguration | null {
  if (!Array.isArray(data)) throw safeError();
  if (data.length === 0) return null;

  const row = oneRow(data);
  if (
    row.organization_id !== organizationId ||
    !isPrimaryLanguage(row.primary_language) ||
    !isFormality(row.formality) ||
    !isCommunicationStyle(row.communication_style) ||
    typeof row.raw_business_context !== "string" ||
    (row.status !== "draft" && row.status !== "ready") ||
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version < 1 ||
    typeof row.handoff_ai_uncertain !== "boolean" ||
    typeof row.handoff_booking_error !== "boolean" ||
    typeof row.handoff_client_requests_admin !== "boolean" ||
    typeof row.handoff_customer_complaint !== "boolean" ||
    typeof row.handoff_medical_question !== "boolean" ||
    typeof row.handoff_payment_dispute !== "boolean" ||
    typeof row.handoff_other_cases !== "string"
  ) {
    throw safeError();
  }

  return {
    communicationStyle: row.communication_style,
    formality: row.formality,
    handoff: {
      aiUncertain: row.handoff_ai_uncertain,
      bookingError: row.handoff_booking_error,
      clientRequestsAdmin: row.handoff_client_requests_admin,
      customerComplaint: row.handoff_customer_complaint,
      medicalQuestion: row.handoff_medical_question,
      otherCases: row.handoff_other_cases,
      paymentDispute: row.handoff_payment_dispute,
    },
    organizationId,
    primaryLanguage: row.primary_language,
    rawBusinessContext: row.raw_business_context,
    status: row.status,
    version: row.version,
  };
}

function mapHistoryRow(
  row: unknown,
  sourceIndex: number,
  triggerCreatedAtMs: number,
): HistoryCandidate | null {
  if (!isRecord(row)) throw safeError();

  if (
    typeof row.id !== "string" ||
    !UUID_PATTERN.test(row.id) ||
    (row.direction !== "inbound" && row.direction !== "outbound") ||
    typeof row.text_content !== "string" ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    typeof row.delivery_status !== "string"
  ) {
    throw safeError();
  }

  if (
    Date.parse(row.created_at) > triggerCreatedAtMs ||
    (row.direction === "outbound" && row.delivery_status === "failed")
  ) {
    return null;
  }

  return {
    createdAt: row.created_at,
    id: row.id,
    isCurrentTrigger: false,
    role: row.direction === "inbound" ? "customer" : "assistant",
    sourceIndex,
    text: row.text_content,
  };
}

function removeOldestNonTrigger(
  messages: HistoryCandidate[],
  triggerMessageId: string,
): boolean {
  const index = messages.findIndex((message) => message.id !== triggerMessageId);
  if (index < 0) return false;
  messages.splice(index, 1);
  return true;
}

export function buildBoundedConversationMessages(
  data: unknown,
  trigger: TriggerMessage,
): ConversationAiContextMessage[] {
  if (!Array.isArray(data)) throw safeError();

  const triggerCreatedAtMs = Date.parse(trigger.createdAt);
  const byId = new Map<string, HistoryCandidate>();

  data.forEach((row, sourceIndex) => {
    const candidate = mapHistoryRow(row, sourceIndex, triggerCreatedAtMs);
    if (candidate) byId.set(candidate.id, candidate);
  });

  const existingTrigger = byId.get(trigger.id);
  byId.set(trigger.id, {
    createdAt: trigger.createdAt,
    id: trigger.id,
    isCurrentTrigger: true,
    role: "customer",
    sourceIndex: existingTrigger?.sourceIndex ?? -1,
    text: trigger.text,
  });

  const messages = [...byId.values()].sort((left, right) => {
    const timestampOrder =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return timestampOrder !== 0
      ? timestampOrder
      : right.sourceIndex - left.sourceIndex;
  });

  while (messages.length > MAX_CONTEXT_MESSAGES) {
    if (!removeOldestNonTrigger(messages, trigger.id)) break;
  }

  let characterCount = messages.reduce(
    (total, message) => total + message.text.length,
    0,
  );

  while (characterCount > MAX_CONTEXT_CHARACTERS && messages.length > 1) {
    const oldest = messages.find((message) => message.id !== trigger.id);
    if (!oldest) break;
    characterCount -= oldest.text.length;
    removeOldestNonTrigger(messages, trigger.id);
  }

  if (characterCount > MAX_CONTEXT_CHARACTERS) {
    const triggerMessage = messages.find((message) => message.id === trigger.id);
    if (!triggerMessage) throw safeError();
    triggerMessage.text = triggerMessage.text.slice(0, MAX_CONTEXT_CHARACTERS);
  }

  return messages.map(({ createdAt, isCurrentTrigger, role, text }) => ({
    createdAt,
    isCurrentTrigger,
    role,
    text,
  }));
}

export async function loadConversationAiContextWithDependencies(
  input: ConversationAiContextInput,
  dependencies: ConversationAiContextDependencies,
): Promise<ConversationAiContextResult> {
  const validatedInput = validateInput(input);

  const organization = mapOrganization(
    await runQuery(() => dependencies.loadOrganization(validatedInput)),
    validatedInput.organizationId,
  );

  validateConversation(
    await runQuery(() => dependencies.loadConversation(validatedInput)),
    validatedInput,
  );

  const trigger = mapTriggerMessage(
    await runQuery(() => dependencies.loadTriggerMessage(validatedInput)),
    validatedInput,
  );

  const configuration = mapConfiguration(
    await runQuery(() =>
      dependencies.loadAiManagerConfiguration(validatedInput),
    ),
    validatedInput.organizationId,
  );

  if (!configuration) {
    return { outcome: "blocked", reason: "ai_configuration_missing" };
  }

  if (configuration.status !== "ready") {
    return { outcome: "blocked", reason: "ai_configuration_not_ready" };
  }

  const messages = buildBoundedConversationMessages(
    await runQuery(() =>
      dependencies.loadRecentMessages({
        ...validatedInput,
        triggerCreatedAt: trigger.createdAt,
      }),
    ),
    trigger,
  );

  return {
    outcome: "ready",
    context: {
      aiManager: {
        businessContext: configuration.rawBusinessContext,
        communicationStyle: configuration.communicationStyle,
        configurationVersion: configuration.version,
        formality: configuration.formality,
        primaryLanguage: configuration.primaryLanguage,
      },
      conversationId: validatedInput.conversationId,
      handoffPolicy: buildHandoffPolicy(
        validatedInput.organizationId,
        configuration,
      ),
      messages,
      organization: { name: organization.name },
      organizationId: validatedInput.organizationId,
      triggerMessageId: validatedInput.triggerMessageId,
    },
  };
}
