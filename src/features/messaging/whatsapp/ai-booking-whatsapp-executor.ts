import "server-only";
import { isBookingAutomationAllowed } from "../../booking/booking-automation-gate";

import { executeAiBookingAction } from "../../booking/ai-booking-action-executor";
import { loadBookingTimeContextForOrganization } from "../../booking/booking-time-context";
import { executePreparedAiWhatsappDispatch } from "./ai-reply-whatsapp-executor";
import { loadAiBookingWhatsappContext, prepareAiBookingWhatsappDispatch } from "./outbound-dispatch-repository";
import { executeAiBookingWhatsappWithDependencies } from "./ai-booking-whatsapp-executor-core";
import type { AiReplyWhatsappExecutionInput } from "./ai-reply-whatsapp-executor-core";

export function executeAiBookingWhatsapp(input: AiReplyWhatsappExecutionInput) {
  return executeAiBookingWhatsappWithDependencies(input, {
    isBookingAutomationAllowed,
    loadContext: loadAiBookingWhatsappContext,
    loadTimeContext: loadBookingTimeContextForOrganization,
    executeAiBookingAction,
    prepareResponse: prepareAiBookingWhatsappDispatch,
    executeDispatch: executePreparedAiWhatsappDispatch,
  });
}
