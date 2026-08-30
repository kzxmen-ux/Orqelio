import type { BookingActionSourceResult } from "./booking-action-source-repository-core.ts";
import type { BookingExecutionResult } from "./booking-execution-core.ts";
import type {
  BookingMutationExecutionIdentity,
  BookingMutationTerminalResult,
  BookingMutationTerminalStoreResult,
  ClaimBookingMutationExecutionResult,
  PrepareBookingMutationExecutionInput,
  PrepareBookingMutationExecutionResult,
} from "./booking-mutation-execution-repository-core.ts";
import type {
  BookingRequestCompositionInput,
  BookingRequestCompositionResult,
} from "./booking-request-composition-core.ts";
import type { BookingOrchestratorInput } from "./booking-orchestrator-core.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATABASE_RETRY_ATTEMPTS = 3;

export type AiBookingActionExecutionInput = {
  organizationId: string;
  aiMessageRunId: string;
  nowInstant: string;
};

type UnresolvedComposition = Extract<
  BookingRequestCompositionResult,
  { status: "needs_input" | "needs_clarification" }
>;

type UnavailableComposition = Extract<
  BookingRequestCompositionResult,
  { status: "unavailable" }
>;

export type AiBookingActionExecutionResult =
  | UnresolvedComposition
  | {
      status: "unavailable";
      code:
        | UnavailableComposition["code"]
        | "booking_source_unavailable"
        | "provider_error";
      retryable: boolean;
    }
  | {
      status: "availability";
      result: Extract<
        BookingExecutionResult,
        { status: "executed"; intent: "check_availability" }
      >["result"];
    }
  | {
      status: "create_succeeded";
      appointment: Extract<BookingMutationTerminalResult, { success: true }>["data"];
    }
  | {
      status: "create_failed";
      code: Exclude<
        Extract<BookingMutationTerminalResult, { success: false }>["code"],
        "provider_error"
      >;
      retryable: boolean;
    }
  | { status: "already_executing" }
  | { status: "indeterminate" };

export type AiBookingActionExecutorDependencies = {
  loadBookingActionSource(
    organizationId: string,
    aiMessageRunId: string,
  ): Promise<BookingActionSourceResult>;
  composeBookingRequestForOrganization(
    input: BookingRequestCompositionInput,
  ): Promise<BookingRequestCompositionResult>;
  executeBookingForOrganization(input: {
    organizationId: string;
    request: BookingOrchestratorInput;
  }): Promise<BookingExecutionResult>;
  prepareBookingMutationExecution(
    input: PrepareBookingMutationExecutionInput,
  ): Promise<PrepareBookingMutationExecutionResult>;
  claimBookingMutationExecution(
    organizationId: string,
    aiMessageRunId: string,
  ): Promise<ClaimBookingMutationExecutionResult>;
  recordBookingMutationSuccess(
    input: BookingMutationExecutionIdentity,
    result: Extract<BookingMutationTerminalResult, { success: true }>,
  ): Promise<BookingMutationTerminalStoreResult>;
  recordBookingMutationFailure(
    input: BookingMutationExecutionIdentity,
    result: Extract<BookingMutationTerminalResult, { success: false }>,
  ): Promise<BookingMutationTerminalStoreResult>;
  markBookingMutationIndeterminate(
    input: BookingMutationExecutionIdentity,
  ): Promise<BookingMutationTerminalStoreResult>;
  waitBeforeRetry?: (attempt: number) => Promise<void>;
};

function unavailable(
  code: Extract<AiBookingActionExecutionResult, { status: "unavailable" }>["code"],
  retryable = false,
): AiBookingActionExecutionResult {
  return { status: "unavailable", code, retryable };
}

async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  waitBeforeRetry?: (attempt: number) => Promise<void>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DATABASE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < DATABASE_RETRY_ATTEMPTS && waitBeforeRetry) {
        try {
          await waitBeforeRetry(attempt);
        } catch {
          // Retry timing is best effort and never authorizes another mutation.
        }
      }
    }
  }

  throw lastError;
}

async function markIndeterminateBestEffort(
  identity: BookingMutationExecutionIdentity,
  dependencies: AiBookingActionExecutorDependencies,
): Promise<void> {
  try {
    await dependencies.markBookingMutationIndeterminate(identity);
  } catch {
    // Stale-execution quarantine remains the durable safety net.
  }
}

function terminalResult(
  result: BookingMutationTerminalResult,
): AiBookingActionExecutionResult {
  if (result.success) {
    return { status: "create_succeeded", appointment: result.data };
  }
  if (result.code === "provider_error") return { status: "indeterminate" };
  return {
    status: "create_failed",
    code: result.code,
    retryable: result.retryable,
  };
}

async function persistTerminalResult(
  identity: BookingMutationExecutionIdentity,
  result: BookingMutationTerminalResult,
  dependencies: AiBookingActionExecutorDependencies,
): Promise<AiBookingActionExecutionResult> {
  if (!result.success && result.code === "provider_error") {
    await markIndeterminateBestEffort(identity, dependencies);
    return { status: "indeterminate" };
  }

  try {
    if (result.success) {
      await retryDatabaseOperation(
        () => dependencies.recordBookingMutationSuccess(identity, result),
        dependencies.waitBeforeRetry,
      );
    } else {
      await retryDatabaseOperation(
        () => dependencies.recordBookingMutationFailure(identity, result),
        dependencies.waitBeforeRetry,
      );
    }
    return terminalResult(result);
  } catch {
    await markIndeterminateBestEffort(identity, dependencies);
    return { status: "indeterminate" };
  }
}

async function executeClaimedCreate(
  organizationId: string,
  claim: Extract<ClaimBookingMutationExecutionResult, { outcome: "claimed" }>,
  dependencies: AiBookingActionExecutorDependencies,
): Promise<AiBookingActionExecutionResult> {
  const identity = { organizationId, executionId: claim.executionId };
  let execution: BookingExecutionResult;

  try {
    execution = await dependencies.executeBookingForOrganization({
      organizationId,
      request: claim.trustedRequest,
    });
  } catch {
    await markIndeterminateBestEffort(identity, dependencies);
    return { status: "indeterminate" };
  }

  if (
    execution.status !== "executed" ||
    execution.intent !== "create_appointment"
  ) {
    if (
      execution.status === "unavailable" &&
      execution.code !== "provider_error"
    ) {
      return persistTerminalResult(
        identity,
        {
          success: false,
          code: execution.code,
          retryable: execution.retryable,
        },
        dependencies,
      );
    }

    await markIndeterminateBestEffort(identity, dependencies);
    return { status: "indeterminate" };
  }

  return persistTerminalResult(identity, execution.result, dependencies);
}

export async function executeAiBookingActionCore(
  input: AiBookingActionExecutionInput,
  dependencies: AiBookingActionExecutorDependencies,
): Promise<AiBookingActionExecutionResult> {
  if (
    !UUID_PATTERN.test(input.organizationId) ||
    !UUID_PATTERN.test(input.aiMessageRunId) ||
    typeof input.nowInstant !== "string" ||
    input.nowInstant.length === 0
  ) {
    return unavailable("booking_source_unavailable");
  }

  try {
    const source = await dependencies.loadBookingActionSource(
      input.organizationId,
      input.aiMessageRunId,
    );
    if (!source.success) return unavailable(source.code);

    if (
      source.source.bookingIntent === "cancel_appointment" ||
      source.source.bookingIntent === "reschedule_appointment"
    ) {
      return unavailable("operation_not_supported");
    }

    const composition =
      await dependencies.composeBookingRequestForOrganization({
        organizationId: input.organizationId,
        conversationId: source.source.conversationId,
        bookingIntent: source.source.bookingIntent,
        bookingRequest: source.source.bookingRequest,
        nowInstant: input.nowInstant,
      });

    if (composition.status !== "ready") {
      return composition;
    }

    if (composition.request.intent === "check_availability") {
      const execution = await dependencies.executeBookingForOrganization({
        organizationId: input.organizationId,
        request: composition.request,
      });
      return execution.status === "executed" &&
        execution.intent === "check_availability"
        ? { status: "availability", result: execution.result }
        : execution.status === "unavailable"
          ? execution
          : unavailable("provider_error");
    }

    if (composition.request.intent !== "create_appointment") {
      return unavailable("operation_not_supported");
    }

    await dependencies.prepareBookingMutationExecution({
      organizationId: input.organizationId,
      aiMessageRunId: input.aiMessageRunId,
      trustedRequest: composition.request,
    });

    const claim = await dependencies.claimBookingMutationExecution(
      input.organizationId,
      input.aiMessageRunId,
    );
    if (claim.outcome === "already_executing") {
      return { status: "already_executing" };
    }
    if (claim.outcome !== "claimed") return terminalResult(claim.result);

    return executeClaimedCreate(input.organizationId, claim, dependencies);
  } catch {
    return unavailable("provider_error");
  }
}
