import type {
  BookingAppointment,
  BookingProviderOperationFailureCode,
  BookingProviderOperationResult,
} from "../crm-connections/providers/booking-operations.ts";
import type { BookingOrchestratorInput } from "./booking-orchestrator-core.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFINITIVE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "connection_unavailable",
  "provider_unavailable",
  "not_found",
  "slot_unavailable",
  "operation_not_supported",
]);

export type TrustedCreateAppointmentRequest = Extract<
  BookingOrchestratorInput,
  { intent: "create_appointment" }
>;

export type BookingMutationExecutionState =
  | "prepared"
  | "executing"
  | "succeeded"
  | "failed"
  | "indeterminate";

export type BookingMutationTerminalResult =
  BookingProviderOperationResult<BookingAppointment>;

export type PrepareBookingMutationExecutionInput = {
  organizationId: string;
  aiMessageRunId: string;
  trustedRequest: TrustedCreateAppointmentRequest;
};

export type BookingMutationExecutionIdentity = {
  organizationId: string;
  executionId: string;
};

export type PrepareBookingMutationExecutionResult = {
  executionId: string;
  state: BookingMutationExecutionState;
  result: BookingMutationTerminalResult | null;
};

export type ClaimBookingMutationExecutionResult =
  | {
      outcome: "claimed";
      executionId: string;
      trustedRequest: TrustedCreateAppointmentRequest;
    }
  | {
      outcome: "already_executing";
      executionId: string;
    }
  | {
      outcome: "succeeded" | "failed" | "indeterminate";
      executionId: string;
      result: BookingMutationTerminalResult;
    };

export type BookingMutationTerminalStoreResult = {
  executionId: string;
  state: "succeeded" | "failed" | "indeterminate";
  result: BookingMutationTerminalResult;
};

export type QuarantineStaleBookingMutationExecutionsResult = {
  quarantinedCount: number;
};

type RpcResult = { data: unknown; error: unknown };

export type BookingMutationExecutionRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResult>;

function repositoryFailure(): Error {
  return new Error("Booking mutation execution repository operation failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isBoundedTrimmedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim()
  );
}

function parseTrustedRequest(
  value: unknown,
): TrustedCreateAppointmentRequest | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 5 ||
    value.intent !== "create_appointment" ||
    !isBoundedTrimmedString(value.serviceId, 255) ||
    !isBoundedTrimmedString(value.staffId, 255) ||
    !isBoundedTrimmedString(value.startAt, 64) ||
    !isRecord(value.customer) ||
    Object.keys(value.customer).length !== 2 ||
    !isBoundedTrimmedString(value.customer.name, 500) ||
    typeof value.customer.phone !== "string" ||
    !/^[0-9]{1,32}$/.test(value.customer.phone)
  ) {
    return null;
  }

  return {
    intent: "create_appointment",
    serviceId: value.serviceId,
    staffId: value.staffId,
    startAt: value.startAt,
    customer: {
      name: value.customer.name,
      phone: value.customer.phone,
    },
  };
}

function parseAppointment(value: unknown): BookingAppointment | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 6 ||
    !isBoundedTrimmedString(value.id, 255) ||
    !isBoundedTrimmedString(value.serviceId, 255) ||
    !isBoundedTrimmedString(value.staffId, 255) ||
    !isBoundedTrimmedString(value.startAt, 64) ||
    !isBoundedTrimmedString(value.endAt, 64) ||
    value.status !== "confirmed"
  ) {
    return null;
  }

  return {
    id: value.id,
    serviceId: value.serviceId,
    staffId: value.staffId,
    startAt: value.startAt,
    endAt: value.endAt,
    status: "confirmed",
  };
}

function parseTerminalResult(
  value: unknown,
): BookingMutationTerminalResult | null {
  if (!isRecord(value)) return null;

  if (
    value.success === true &&
    Object.keys(value).length === 2
  ) {
    const appointment = parseAppointment(value.data);
    return appointment === null
      ? null
      : { success: true, data: appointment };
  }

  if (
    value.success === false &&
    Object.keys(value).length === 3 &&
    isFailureCode(value.code) &&
    typeof value.retryable === "boolean"
  ) {
    return {
      success: false,
      code: value.code,
      retryable: value.retryable,
    };
  }

  return null;
}

function isFailureCode(
  value: unknown,
): value is BookingProviderOperationFailureCode {
  return (
    typeof value === "string" &&
    (DEFINITIVE_FAILURE_CODES.has(value) || value === "provider_error")
  );
}

function isState(value: unknown): value is BookingMutationExecutionState {
  return (
    value === "prepared" ||
    value === "executing" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "indeterminate"
  );
}

async function callRpc<T>(
  rpc: BookingMutationExecutionRpc,
  functionName: string,
  parameters: Record<string, unknown>,
  normalize: (data: unknown) => T,
): Promise<T> {
  try {
    const { data, error } = await rpc(functionName, parameters);
    if (error !== null) throw repositoryFailure();
    return normalize(data);
  } catch {
    throw repositoryFailure();
  }
}

function onlyRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw repositoryFailure();
  }
  return data[0];
}

function normalizePrepared(data: unknown): PrepareBookingMutationExecutionResult {
  const row = onlyRow(data);
  if (!isUuid(row.execution_id) || !isState(row.execution_state)) {
    throw repositoryFailure();
  }

  const result = row.terminal_result === null
    ? null
    : parseTerminalResult(row.terminal_result);
  if (
    (row.execution_state === "prepared" || row.execution_state === "executing")
      ? result !== null
      : result === null
  ) {
    throw repositoryFailure();
  }

  return {
    executionId: row.execution_id,
    state: row.execution_state,
    result,
  };
}

function normalizeClaim(data: unknown): ClaimBookingMutationExecutionResult {
  const row = onlyRow(data);
  if (!isUuid(row.execution_id)) throw repositoryFailure();

  if (row.outcome === "claimed") {
    const trustedRequest = parseTrustedRequest(row.trusted_request);
    if (trustedRequest === null || row.terminal_result !== null) {
      throw repositoryFailure();
    }
    return { outcome: "claimed", executionId: row.execution_id, trustedRequest };
  }

  if (row.outcome === "already_executing") {
    if (row.trusted_request !== null || row.terminal_result !== null) {
      throw repositoryFailure();
    }
    return { outcome: "already_executing", executionId: row.execution_id };
  }

  if (
    row.outcome === "succeeded" ||
    row.outcome === "failed" ||
    row.outcome === "indeterminate"
  ) {
    const result = parseTerminalResult(row.terminal_result);
    if (row.trusted_request !== null || result === null) {
      throw repositoryFailure();
    }
    return { outcome: row.outcome, executionId: row.execution_id, result };
  }

  throw repositoryFailure();
}

function normalizeTerminalStore(
  data: unknown,
): BookingMutationTerminalStoreResult {
  const prepared = normalizePrepared(data);
  if (
    (prepared.state !== "succeeded" &&
      prepared.state !== "failed" &&
      prepared.state !== "indeterminate") ||
    prepared.result === null
  ) {
    throw repositoryFailure();
  }

  return {
    executionId: prepared.executionId,
    state: prepared.state,
    result: prepared.result,
  };
}

function validateIdentity(
  input: BookingMutationExecutionIdentity,
): BookingMutationExecutionIdentity {
  if (!isUuid(input.organizationId) || !isUuid(input.executionId)) {
    throw repositoryFailure();
  }
  return input;
}

export function prepareBookingMutationExecutionWithRpc(
  input: PrepareBookingMutationExecutionInput,
  rpc: BookingMutationExecutionRpc,
): Promise<PrepareBookingMutationExecutionResult> {
  const trustedRequest = parseTrustedRequest(input.trustedRequest);
  if (
    !isUuid(input.organizationId) ||
    !isUuid(input.aiMessageRunId) ||
    trustedRequest === null
  ) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "prepare_booking_mutation_execution",
    {
      p_organization_id: input.organizationId,
      p_ai_message_run_id: input.aiMessageRunId,
      p_trusted_request: trustedRequest,
    },
    normalizePrepared,
  );
}

export function claimBookingMutationExecutionWithRpc(
  organizationId: string,
  aiMessageRunId: string,
  rpc: BookingMutationExecutionRpc,
): Promise<ClaimBookingMutationExecutionResult> {
  if (!isUuid(organizationId) || !isUuid(aiMessageRunId)) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "claim_booking_mutation_execution",
    {
      p_organization_id: organizationId,
      p_ai_message_run_id: aiMessageRunId,
    },
    normalizeClaim,
  );
}

export function findBookingMutationExecutionWithRpc(
  organizationId: string,
  aiMessageRunId: string,
  rpc: BookingMutationExecutionRpc,
): Promise<PrepareBookingMutationExecutionResult | null> {
  if (!isUuid(organizationId) || !isUuid(aiMessageRunId)) throw repositoryFailure();
  return callRpc(rpc, "find_booking_mutation_execution", {
    p_organization_id: organizationId, p_ai_message_run_id: aiMessageRunId,
  }, (data) => Array.isArray(data) && data.length === 0 ? null : normalizePrepared(data));
}

export function recordBookingMutationSuccessWithRpc(
  input: BookingMutationExecutionIdentity,
  result: Extract<BookingMutationTerminalResult, { success: true }>,
  rpc: BookingMutationExecutionRpc,
): Promise<BookingMutationTerminalStoreResult> {
  const identity = validateIdentity(input);
  if (parseTerminalResult(result)?.success !== true) throw repositoryFailure();

  return callRpc(
    rpc,
    "record_booking_mutation_success",
    {
      p_organization_id: identity.organizationId,
      p_execution_id: identity.executionId,
      p_terminal_result: result,
    },
    normalizeTerminalStore,
  );
}

export function recordBookingMutationFailureWithRpc(
  input: BookingMutationExecutionIdentity,
  result: Extract<BookingMutationTerminalResult, { success: false }>,
  rpc: BookingMutationExecutionRpc,
): Promise<BookingMutationTerminalStoreResult> {
  const identity = validateIdentity(input);
  if (
    !DEFINITIVE_FAILURE_CODES.has(result.code) ||
    parseTerminalResult(result)?.success !== false
  ) {
    throw repositoryFailure();
  }

  return callRpc(
    rpc,
    "record_booking_mutation_failure",
    {
      p_organization_id: identity.organizationId,
      p_execution_id: identity.executionId,
      p_terminal_result: result,
    },
    normalizeTerminalStore,
  );
}

export function markBookingMutationIndeterminateWithRpc(
  input: BookingMutationExecutionIdentity,
  rpc: BookingMutationExecutionRpc,
): Promise<BookingMutationTerminalStoreResult> {
  const identity = validateIdentity(input);
  return callRpc(
    rpc,
    "mark_booking_mutation_indeterminate",
    {
      p_organization_id: identity.organizationId,
      p_execution_id: identity.executionId,
    },
    normalizeTerminalStore,
  );
}

export function quarantineStaleBookingMutationExecutionsWithRpc(
  limit: number | undefined,
  rpc: BookingMutationExecutionRpc,
): Promise<QuarantineStaleBookingMutationExecutionsResult> {
  if (limit !== undefined && !Number.isFinite(limit)) throw repositoryFailure();
  const normalizedLimit = limit === undefined
    ? 25
    : Math.min(50, Math.max(1, Math.trunc(limit)));

  return callRpc(
    rpc,
    "quarantine_stale_booking_mutation_executions",
    { p_limit: normalizedLimit },
    (data) => {
      const row = onlyRow(data);
      if (
        Object.keys(row).length !== 1 ||
        typeof row.quarantined_count !== "number" ||
        !Number.isInteger(row.quarantined_count) ||
        row.quarantined_count < 0 ||
        row.quarantined_count > normalizedLimit
      ) {
        throw repositoryFailure();
      }
      return { quarantinedCount: row.quarantined_count };
    },
  );
}
