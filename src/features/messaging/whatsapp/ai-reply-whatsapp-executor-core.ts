import type {
  ClaimAiReplyWhatsappDispatchExecutionInput,
  ClaimAiReplyWhatsappDispatchExecutionResult,
  PrepareAiReplyWhatsappDispatchInput,
  RecordWhatsappProviderAcceptanceInput,
  WhatsappOutboundDispatchFinalizationResult,
  WhatsappOutboundDispatchIdentity,
  WhatsappOutboundDispatchResult,
} from "./outbound-dispatch-repository-core";
import type {
  WhatsappTextMessageInput,
  WhatsappTextMessageResult,
} from "./outbound-text-sender-core";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_MESSAGE_ID_MAX_LENGTH = 255;
const DATABASE_RETRY_ATTEMPTS = 3;
const SAFE_EXECUTOR_ERROR = "AI reply WhatsApp executor failed.";

export type AiReplyWhatsappExecutionInput = {
  organizationId: string;
  aiMessageRunId: string;
};

export type AiReplyWhatsappExecutionResult =
  | {
      outcome: "persisted";
      dispatchId: string;
    }
  | {
      outcome: "provider_accepted";
      dispatchId: string;
    }
  | {
      outcome: "already_dispatching";
      dispatchId: string;
    }
  | {
      outcome: "indeterminate";
      dispatchId: string;
    };

export type AiReplyWhatsappExecutorDependencies = {
  prepareAiReplyWhatsappDispatch: (
    input: PrepareAiReplyWhatsappDispatchInput,
  ) => Promise<WhatsappOutboundDispatchResult>;
  claimAiReplyWhatsappDispatchExecution: (
    input: ClaimAiReplyWhatsappDispatchExecutionInput,
  ) => Promise<ClaimAiReplyWhatsappDispatchExecutionResult>;
  sendWhatsappTextMessage: (
    input: WhatsappTextMessageInput,
  ) => Promise<WhatsappTextMessageResult>;
  recordWhatsappOutboundProviderAcceptance: (
    input: RecordWhatsappProviderAcceptanceInput,
  ) => Promise<WhatsappOutboundDispatchResult>;
  finalizeWhatsappOutboundDispatch: (
    input: WhatsappOutboundDispatchIdentity,
  ) => Promise<WhatsappOutboundDispatchFinalizationResult>;
  markWhatsappOutboundDispatchIndeterminate: (
    input: WhatsappOutboundDispatchIdentity,
  ) => Promise<WhatsappOutboundDispatchResult>;
  waitBeforeRetry?: (attempt: number) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function executorFailure(): Error {
  return new Error(SAFE_EXECUTOR_ERROR);
}

function validateInput(input: unknown): AiReplyWhatsappExecutionInput {
  if (
    !isRecord(input) ||
    typeof input.organizationId !== "string" ||
    !UUID_PATTERN.test(input.organizationId) ||
    typeof input.aiMessageRunId !== "string" ||
    !UUID_PATTERN.test(input.aiMessageRunId)
  ) {
    throw executorFailure();
  }

  return {
    aiMessageRunId: input.aiMessageRunId,
    organizationId: input.organizationId,
  };
}

function isProviderMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= PROVIDER_MESSAGE_ID_MAX_LENGTH &&
    value === value.trim()
  );
}

async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  waitBeforeRetry?: (attempt: number) => Promise<void>,
): Promise<T> {
  let lastFailure: unknown = executorFailure();

  for (let attempt = 1; attempt <= DATABASE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastFailure = error;

      if (attempt < DATABASE_RETRY_ATTEMPTS && waitBeforeRetry) {
        try {
          await waitBeforeRetry(attempt);
        } catch {
          // Retry delays are best effort and never change the send policy.
        }
      }
    }
  }

  throw lastFailure;
}

async function markIndeterminateBestEffort(
  input: WhatsappOutboundDispatchIdentity,
  dependencies: AiReplyWhatsappExecutorDependencies,
): Promise<void> {
  try {
    await dependencies.markWhatsappOutboundDispatchIndeterminate(input);
  } catch {
    // Stale dispatch quarantine remains the final safety net.
  }
}

async function finalizeProviderAcceptedDispatch(
  input: WhatsappOutboundDispatchIdentity,
  dependencies: AiReplyWhatsappExecutorDependencies,
): Promise<AiReplyWhatsappExecutionResult> {
  try {
    await retryDatabaseOperation(
      () => dependencies.finalizeWhatsappOutboundDispatch(input),
      dependencies.waitBeforeRetry,
    );
    return { dispatchId: input.dispatchId, outcome: "persisted" };
  } catch {
    return { dispatchId: input.dispatchId, outcome: "provider_accepted" };
  }
}

function stateOnlyResult(
  result:
    | WhatsappOutboundDispatchResult
    | Exclude<ClaimAiReplyWhatsappDispatchExecutionResult, { outcome: "claimed" }>,
): AiReplyWhatsappExecutionResult | null {
  const outcome = "state" in result ? result.state : result.outcome;

  if (outcome === "dispatching" || outcome === "already_dispatching") {
    return { dispatchId: result.dispatchId, outcome: "already_dispatching" };
  }

  if (outcome === "persisted" || outcome === "indeterminate") {
    return { dispatchId: result.dispatchId, outcome };
  }

  return null;
}

export async function executeAiReplyWhatsappWithDependencies(
  input: AiReplyWhatsappExecutionInput,
  dependencies: AiReplyWhatsappExecutorDependencies,
): Promise<AiReplyWhatsappExecutionResult> {
  const validatedInput = validateInput(input);
  let prepared: WhatsappOutboundDispatchResult;

  try {
    prepared = await dependencies.prepareAiReplyWhatsappDispatch(validatedInput);
  } catch {
    throw executorFailure();
  }

  const preparedStateResult = stateOnlyResult(prepared);
  if (preparedStateResult) return preparedStateResult;

  if (prepared.state === "provider_accepted") {
    return finalizeProviderAcceptedDispatch(
      {
        dispatchId: prepared.dispatchId,
        organizationId: validatedInput.organizationId,
      },
      dependencies,
    );
  }

  let claim: ClaimAiReplyWhatsappDispatchExecutionResult;

  try {
    claim = await dependencies.claimAiReplyWhatsappDispatchExecution(
      validatedInput,
    );

    if (claim.dispatchId !== prepared.dispatchId) throw executorFailure();
  } catch {
    throw executorFailure();
  }

  if (claim.outcome !== "claimed") {
    const claimStateResult = stateOnlyResult(claim);
    if (claimStateResult) return claimStateResult;

    return finalizeProviderAcceptedDispatch(
      {
        dispatchId: claim.dispatchId,
        organizationId: validatedInput.organizationId,
      },
      dependencies,
    );
  }

  let providerMessageId: string;

  try {
    const sendResult = await dependencies.sendWhatsappTextMessage({
      phoneNumberId: claim.phoneNumberId,
      recipientWaId: claim.recipientWaId,
      text: claim.text,
    });

    if (!isProviderMessageId(sendResult.providerMessageId)) {
      throw executorFailure();
    }

    providerMessageId = sendResult.providerMessageId;
  } catch {
    await markIndeterminateBestEffort(
      {
        dispatchId: claim.dispatchId,
        organizationId: validatedInput.organizationId,
      },
      dependencies,
    );
    return { dispatchId: claim.dispatchId, outcome: "indeterminate" };
  }

  let recorded: WhatsappOutboundDispatchResult;

  try {
    recorded = await retryDatabaseOperation(async () => {
      const result =
        await dependencies.recordWhatsappOutboundProviderAcceptance({
          dispatchId: claim.dispatchId,
          organizationId: validatedInput.organizationId,
          providerMessageId,
        });

      if (
        result.dispatchId !== claim.dispatchId ||
        (result.state !== "provider_accepted" && result.state !== "persisted")
      ) {
        throw executorFailure();
      }

      return result;
    }, dependencies.waitBeforeRetry);
  } catch {
    await markIndeterminateBestEffort(
      {
        dispatchId: claim.dispatchId,
        organizationId: validatedInput.organizationId,
      },
      dependencies,
    );
    return { dispatchId: claim.dispatchId, outcome: "indeterminate" };
  }

  if (recorded.state === "persisted") {
    return { dispatchId: claim.dispatchId, outcome: "persisted" };
  }

  return finalizeProviderAcceptedDispatch(
    {
      dispatchId: claim.dispatchId,
      organizationId: validatedInput.organizationId,
    },
    dependencies,
  );
}
