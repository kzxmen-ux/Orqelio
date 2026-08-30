import "server-only";

import { executeAiReplyWhatsapp } from "./ai-reply-whatsapp-executor";
import { executeAiBookingWhatsapp } from "./ai-booking-whatsapp-executor";
import { quarantineStaleBookingMutationExecutions } from "../../booking/booking-mutation-execution-repository";
import {
  runAiReplyWhatsappExecutionWorkerWithDependencies,
  type AiReplyWhatsappExecutionWorkerResult,
} from "./ai-reply-whatsapp-execution-worker-core";
import {
  listActionableAiBookingWhatsappExecutions,
  listActionableAiReplyWhatsappExecutions,
  quarantineStaleAiReplyWhatsappDispatches,
} from "./outbound-dispatch-repository";

export async function runAiReplyWhatsappExecutionWorker(
  limit?: number,
): Promise<AiReplyWhatsappExecutionWorkerResult> {
  const replies = await runAiReplyWhatsappExecutionWorkerWithDependencies(limit, {
    executeReply: executeAiReplyWhatsapp,
    listActionable: listActionableAiReplyWhatsappExecutions,
    quarantineStale: quarantineStaleAiReplyWhatsappDispatches,
  });
  const bookings = await runAiReplyWhatsappExecutionWorkerWithDependencies(limit, {
    executeReply: executeAiBookingWhatsapp,
    listActionable: listActionableAiBookingWhatsappExecutions,
    quarantineStale: quarantineStaleBookingMutationExecutions,
  });
  return {
    quarantinedCount: replies.quarantinedCount + bookings.quarantinedCount,
    candidateCount: replies.candidateCount + bookings.candidateCount,
    persistedCount: replies.persistedCount + bookings.persistedCount,
    providerAcceptedCount: replies.providerAcceptedCount + bookings.providerAcceptedCount,
    alreadyDispatchingCount: replies.alreadyDispatchingCount + bookings.alreadyDispatchingCount,
    indeterminateCount: replies.indeterminateCount + bookings.indeterminateCount,
    failedCount: replies.failedCount + bookings.failedCount,
  };
}
