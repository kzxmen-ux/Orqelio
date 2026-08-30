import "server-only";

import {
  claimAiReplyWhatsappDispatchExecution,
  finalizeWhatsappOutboundDispatch,
  markWhatsappOutboundDispatchIndeterminate,
  prepareAiReplyWhatsappDispatch,
  recordWhatsappOutboundProviderAcceptance,
} from "./outbound-dispatch-repository";
import { sendWhatsappTextMessage } from "./outbound-text-sender";
import type { WhatsappOutboundDispatchResult } from "./outbound-dispatch-repository-core";
import {
  executeAiReplyWhatsappWithDependencies,
  type AiReplyWhatsappExecutionInput,
  type AiReplyWhatsappExecutionResult,
} from "./ai-reply-whatsapp-executor-core";

const DATABASE_RETRY_DELAY_MS = 25;

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, DATABASE_RETRY_DELAY_MS * attempt);
  });
}

export function executeAiReplyWhatsapp(
  input: AiReplyWhatsappExecutionInput,
): Promise<AiReplyWhatsappExecutionResult> {
  return executeAiReplyWhatsappWithDependencies(input, {
    claimAiReplyWhatsappDispatchExecution,
    finalizeWhatsappOutboundDispatch,
    markWhatsappOutboundDispatchIndeterminate,
    prepareAiReplyWhatsappDispatch,
    recordWhatsappOutboundProviderAcceptance,
    sendWhatsappTextMessage,
    waitBeforeRetry,
  });
}

// Booking responses reuse the same claim, transport and acceptance recovery.
// The prepared text is already immutable and bound to this AI run in the DB.
export function executePreparedAiWhatsappDispatch(
  input: AiReplyWhatsappExecutionInput,
  prepared: WhatsappOutboundDispatchResult,
): Promise<AiReplyWhatsappExecutionResult> {
  return executeAiReplyWhatsappWithDependencies(input, {
    claimAiReplyWhatsappDispatchExecution,
    finalizeWhatsappOutboundDispatch,
    markWhatsappOutboundDispatchIndeterminate,
    prepareAiReplyWhatsappDispatch: async () => prepared,
    recordWhatsappOutboundProviderAcceptance,
    sendWhatsappTextMessage,
    waitBeforeRetry,
  });
}
