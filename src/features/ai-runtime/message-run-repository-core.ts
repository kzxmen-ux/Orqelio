import type {
  AiInboundProcessingInput,
  AiInboundProcessingResult,
} from "./inbound-processing-core.ts";
import {
  MAX_MODEL_BOOKING_REQUEST_FIELD_CHARACTERS,
  MODEL_BOOKING_INTENTS,
  MODEL_BOOKING_REQUEST_FIELDS,
  type ModelBookingIntent,
  type ModelBookingRequest,
} from "./decision-types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKING_INTENTS: ReadonlySet<string> = new Set(
  MODEL_BOOKING_INTENTS.filter((intent) => intent !== "none"),
);

type AiMessageRunTerminalStatus = "decided" | "blocked" | "failed";
type DurableBookingIntent = Exclude<ModelBookingIntent, "none">;

export type AiMessageRunClaimResult =
  | {
      outcome: "claimed";
      runId: string;
      status: "processing";
      attemptCount: number;
    }
  | {
      outcome: "already_processing";
      runId: string;
      status: "processing";
      attemptCount: number;
    }
  | {
      outcome: "already_terminal";
      runId: string;
      status: AiMessageRunTerminalStatus;
      attemptCount: number;
    };

export type AiMessageRunTerminalStoreResult = {
  outcome: "stored" | "already_terminal";
  runId: string;
  status: AiMessageRunTerminalStatus;
};

export type AiMessageRunRecoveryCandidate = {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
  attemptCount: number;
};

export type AiMessageRunRecoveryResult = {
  retryable: readonly AiMessageRunRecoveryCandidate[];
  exhaustedCount: number;
};

export type AiMessageRunRpcResult = {
  data: unknown;
  error: unknown;
};

export type AiMessageRunRpc = (
  functionName:
    | "claim_ai_message_run"
    | "complete_ai_message_run"
    | "list_pending_ai_message_runs"
    | "recover_stale_ai_message_runs",
  parameters: Record<string, unknown>,
) => Promise<AiMessageRunRpcResult>;

type SafeDecision =
  | { action: "reply"; text: string }
  | {
      action: "booking_action_required";
      bookingIntent: DurableBookingIntent;
      bookingRequest: ModelBookingRequest;
    }
  | { action: "handoff"; reasonCode: string; safeReason: string }
  | { action: "no_safe_answer"; reason: string };

function repositoryFailure(): Error {
  return new Error("AI message run repository operation failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBoundedString(
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

function isTerminalStatus(
  value: unknown,
): value is AiMessageRunTerminalStatus {
  return value === "decided" || value === "blocked" || value === "failed";
}

function isDurableBookingIntent(
  value: unknown,
): value is DurableBookingIntent {
  return typeof value === "string" && BOOKING_INTENTS.has(value);
}

type SanitizedBookingRequestField =
  | { valid: true; value: string | null }
  | { valid: false };

function sanitizeBookingRequestField(
  value: unknown,
): SanitizedBookingRequestField {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false };

  const normalized = value.trim();
  if (normalized.length > MAX_MODEL_BOOKING_REQUEST_FIELD_CHARACTERS) {
    return { valid: false };
  }

  return {
    valid: true,
    value: normalized.length === 0 ? null : normalized,
  };
}

function sanitizeBookingRequest(value: unknown): ModelBookingRequest | null {
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== MODEL_BOOKING_REQUEST_FIELDS.length ||
    !MODEL_BOOKING_REQUEST_FIELDS.every((field) =>
      Object.hasOwn(value, field),
    )
  ) {
    return null;
  }

  const serviceQuery = sanitizeBookingRequestField(value.serviceQuery);
  const staffQuery = sanitizeBookingRequestField(value.staffQuery);
  const dateText = sanitizeBookingRequestField(value.dateText);
  const timeText = sanitizeBookingRequestField(value.timeText);
  const customerName = sanitizeBookingRequestField(value.customerName);
  const customerPhone = sanitizeBookingRequestField(value.customerPhone);
  const appointmentReference = sanitizeBookingRequestField(
    value.appointmentReference,
  );
  if (
    !serviceQuery.valid ||
    !staffQuery.valid ||
    !dateText.valid ||
    !timeText.valid ||
    !customerName.valid ||
    !customerPhone.valid ||
    !appointmentReference.valid
  ) {
    return null;
  }

  return {
    serviceQuery: serviceQuery.value,
    staffQuery: staffQuery.value,
    dateText: dateText.value,
    timeText: timeText.value,
    customerName: customerName.value,
    customerPhone: customerPhone.value,
    appointmentReference: appointmentReference.value,
  };
}

function sanitizeDecision(value: unknown): SafeDecision | null {
  if (!isRecord(value)) return null;

  switch (value.action) {
    case "reply":
      return isBoundedString(value.text, 2_000)
        ? { action: "reply", text: value.text }
        : null;
    case "booking_action_required":
      if (
        !isDurableBookingIntent(value.bookingIntent)
      ) {
        return null;
      }

      const bookingRequest = sanitizeBookingRequest(value.bookingRequest);
      return bookingRequest
        ? {
            action: "booking_action_required",
            bookingIntent: value.bookingIntent,
            bookingRequest,
          }
        : null;
    case "handoff":
      return isBoundedString(value.reasonCode, 128) &&
        isBoundedString(value.safeReason, 512)
        ? {
            action: "handoff",
            reasonCode: value.reasonCode,
            safeReason: value.safeReason,
          }
        : null;
    case "no_safe_answer":
      return isBoundedString(value.reason, 128)
        ? { action: "no_safe_answer", reason: value.reason }
        : null;
    default:
      return null;
  }
}

function parseClaimResult(data: unknown): AiMessageRunClaimResult | null {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return null;
  }

  const row = data[0];

  if (
    !isUuid(row.run_id) ||
    !Number.isInteger(row.attempt_count) ||
    typeof row.attempt_count !== "number" ||
    row.attempt_count < 1
  ) {
    return null;
  }

  if (
    row.outcome === "claimed" &&
    row.run_status === "processing"
  ) {
    return {
      outcome: "claimed",
      runId: row.run_id,
      status: "processing",
      attemptCount: row.attempt_count,
    };
  }

  if (
    row.outcome === "already_processing" &&
    row.run_status === "processing"
  ) {
    return {
      outcome: "already_processing",
      runId: row.run_id,
      status: "processing",
      attemptCount: row.attempt_count,
    };
  }

  if (row.outcome === "already_terminal" && isTerminalStatus(row.run_status)) {
    return {
      outcome: "already_terminal",
      runId: row.run_id,
      status: row.run_status,
      attemptCount: row.attempt_count,
    };
  }

  return null;
}

function parseTerminalStoreResult(
  data: unknown,
): AiMessageRunTerminalStoreResult | null {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return null;
  }

  const row = data[0];

  if (
    (row.outcome !== "stored" && row.outcome !== "already_terminal") ||
    !isUuid(row.run_id) ||
    !isTerminalStatus(row.run_status)
  ) {
    return null;
  }

  return {
    outcome: row.outcome,
    runId: row.run_id,
    status: row.run_status,
  };
}

function normalizeBatchLimit(limit: number | undefined): number {
  if (limit === undefined) return 25;
  if (!Number.isFinite(limit)) throw repositoryFailure();

  return Math.min(50, Math.max(1, Math.trunc(limit)));
}

function parsePendingCandidates(
  data: unknown,
  limit: number,
): readonly AiMessageRunRecoveryCandidate[] | null {
  if (!Array.isArray(data) || data.length > limit) return null;

  const candidates: AiMessageRunRecoveryCandidate[] = [];

  for (const candidate of data) {
    if (
      !isRecord(candidate) ||
      !isUuid(candidate.organization_id) ||
      !isUuid(candidate.conversation_id) ||
      !isUuid(candidate.trigger_message_id) ||
      !Number.isInteger(candidate.attempt_count) ||
      typeof candidate.attempt_count !== "number" ||
      candidate.attempt_count < 0 ||
      candidate.attempt_count >= 3
    ) {
      return null;
    }

    candidates.push({
      organizationId: candidate.organization_id,
      conversationId: candidate.conversation_id,
      triggerMessageId: candidate.trigger_message_id,
      attemptCount: candidate.attempt_count,
    });
  }

  return candidates;
}

function parseRecoveryResult(
  data: unknown,
  limit: number,
): AiMessageRunRecoveryResult | null {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    return null;
  }

  const row = data[0];

  if (
    !Array.isArray(row.retryable) ||
    !Number.isInteger(row.exhausted_count) ||
    typeof row.exhausted_count !== "number" ||
    row.exhausted_count < 0 ||
    row.retryable.length + row.exhausted_count > limit
  ) {
    return null;
  }

  const retryable: AiMessageRunRecoveryCandidate[] = [];

  for (const candidate of row.retryable) {
    if (
      !isRecord(candidate) ||
      !isUuid(candidate.organization_id) ||
      !isUuid(candidate.conversation_id) ||
      !isUuid(candidate.trigger_message_id) ||
      !Number.isInteger(candidate.attempt_count) ||
      typeof candidate.attempt_count !== "number" ||
      candidate.attempt_count < 1 ||
      candidate.attempt_count >= 3
    ) {
      return null;
    }

    retryable.push({
      organizationId: candidate.organization_id,
      conversationId: candidate.conversation_id,
      triggerMessageId: candidate.trigger_message_id,
      attemptCount: candidate.attempt_count,
    });
  }

  return {
    retryable,
    exhaustedCount: row.exhausted_count,
  };
}

export async function claimAiMessageRunWithRpc(
  input: AiInboundProcessingInput,
  rpc: AiMessageRunRpc,
): Promise<AiMessageRunClaimResult> {
  if (
    !isUuid(input.organizationId) ||
    !isUuid(input.conversationId) ||
    !isUuid(input.triggerMessageId)
  ) {
    throw repositoryFailure();
  }

  let rpcResult: AiMessageRunRpcResult;

  try {
    rpcResult = await rpc("claim_ai_message_run", {
      p_conversation_id: input.conversationId,
      p_organization_id: input.organizationId,
      p_trigger_message_id: input.triggerMessageId,
    });
  } catch {
    throw repositoryFailure();
  }

  if (rpcResult.error) throw repositoryFailure();

  const result = parseClaimResult(rpcResult.data);

  if (!result) throw repositoryFailure();

  return result;
}

export async function storeAiMessageRunTerminalResultWithRpc(
  runId: string,
  result: AiInboundProcessingResult,
  rpc: AiMessageRunRpc,
): Promise<AiMessageRunTerminalStoreResult> {
  if (!isUuid(runId)) throw repositoryFailure();

  let terminalStatus: AiMessageRunTerminalStatus;
  let decision: SafeDecision | null = null;
  let failureReason: string | null = null;

  if (result.outcome === "decided") {
    terminalStatus = "decided";
    decision = sanitizeDecision(result.decision);

    if (!decision) throw repositoryFailure();
  } else {
    terminalStatus = result.outcome;
    failureReason = result.reason;

    if (!isBoundedString(failureReason, 128)) throw repositoryFailure();
  }

  let rpcResult: AiMessageRunRpcResult;

  try {
    rpcResult = await rpc("complete_ai_message_run", {
      p_decision: decision,
      p_failure_reason: failureReason,
      p_run_id: runId,
      p_terminal_status: terminalStatus,
    });
  } catch {
    throw repositoryFailure();
  }

  if (rpcResult.error) throw repositoryFailure();

  const stored = parseTerminalStoreResult(rpcResult.data);

  if (!stored) throw repositoryFailure();

  return stored;
}

export async function recoverStaleAiMessageRunsWithRpc(
  limit: number | undefined,
  rpc: AiMessageRunRpc,
): Promise<AiMessageRunRecoveryResult> {
  const normalizedLimit = normalizeBatchLimit(limit);
  let rpcResult: AiMessageRunRpcResult;

  try {
    rpcResult = await rpc("recover_stale_ai_message_runs", {
      p_limit: normalizedLimit,
    });
  } catch {
    throw repositoryFailure();
  }

  if (rpcResult.error) throw repositoryFailure();

  const recovered = parseRecoveryResult(rpcResult.data, normalizedLimit);

  if (!recovered) throw repositoryFailure();

  return recovered;
}

export async function listPendingAiMessageRunsWithRpc(
  limit: number | undefined,
  rpc: AiMessageRunRpc,
): Promise<readonly AiMessageRunRecoveryCandidate[]> {
  const normalizedLimit = normalizeBatchLimit(limit);
  let rpcResult: AiMessageRunRpcResult;

  try {
    rpcResult = await rpc("list_pending_ai_message_runs", {
      p_limit: normalizedLimit,
    });
  } catch {
    throw repositoryFailure();
  }

  if (rpcResult.error) throw repositoryFailure();

  const candidates = parsePendingCandidates(rpcResult.data, normalizedLimit);

  if (!candidates) throw repositoryFailure();

  return candidates;
}
