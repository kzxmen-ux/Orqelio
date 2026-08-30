import "server-only";

import { loadBookingActionSource } from "./booking-action-source-repository";
import {
  executeAiBookingActionCore,
  type AiBookingActionExecutionResult,
} from "./ai-booking-action-executor-core";
import { executeBookingForOrganization } from "./booking-execution";
import {
  claimBookingMutationExecution,
  markBookingMutationIndeterminate,
  prepareBookingMutationExecution,
  recordBookingMutationFailure,
  recordBookingMutationSuccess,
} from "./booking-mutation-execution-repository";
import { composeBookingRequestForOrganization } from "./booking-request-composition";

export type ExecuteAiBookingActionInput = {
  organizationId: string;
  aiMessageRunId: string;
};

export function executeAiBookingAction(
  input: ExecuteAiBookingActionInput,
): Promise<AiBookingActionExecutionResult> {
  return executeAiBookingActionCore(
    { ...input, nowInstant: new Date().toISOString() },
    {
      loadBookingActionSource,
      composeBookingRequestForOrganization,
      executeBookingForOrganization,
      prepareBookingMutationExecution,
      claimBookingMutationExecution,
      recordBookingMutationSuccess,
      recordBookingMutationFailure,
      markBookingMutationIndeterminate,
    },
  );
}

export type { AiBookingActionExecutionResult } from "./ai-booking-action-executor-core";
