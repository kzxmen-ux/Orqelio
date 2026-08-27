import "server-only";

import { executeAiReplyWhatsapp } from "./ai-reply-whatsapp-executor";
import {
  runAiReplyWhatsappExecutionWorkerWithDependencies,
  type AiReplyWhatsappExecutionWorkerResult,
} from "./ai-reply-whatsapp-execution-worker-core";
import {
  listActionableAiReplyWhatsappExecutions,
  quarantineStaleAiReplyWhatsappDispatches,
} from "./outbound-dispatch-repository";

export function runAiReplyWhatsappExecutionWorker(
  limit?: number,
): Promise<AiReplyWhatsappExecutionWorkerResult> {
  return runAiReplyWhatsappExecutionWorkerWithDependencies(limit, {
    executeReply: executeAiReplyWhatsapp,
    listActionable: listActionableAiReplyWhatsappExecutions,
    quarantineStale: quarantineStaleAiReplyWhatsappDispatches,
  });
}
