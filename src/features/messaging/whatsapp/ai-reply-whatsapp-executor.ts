import "server-only";

import {
  claimAiReplyWhatsappDispatchExecution,
  finalizeWhatsappOutboundDispatch,
  markWhatsappOutboundDispatchIndeterminate,
  prepareAiReplyWhatsappDispatch,
  recordWhatsappOutboundProviderAcceptance,
} from "./outbound-dispatch-repository";
import { sendWhatsappTextMessage } from "./outbound-text-sender";
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
