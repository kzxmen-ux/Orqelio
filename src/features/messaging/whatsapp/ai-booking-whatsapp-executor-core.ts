import type { AiBookingActionExecutionResult } from "../../booking/ai-booking-action-executor-core.ts";
import type { BookingTimeContextResult } from "../../booking/booking-time-context-core.ts";
import type { AiReplyWhatsappExecutionInput, AiReplyWhatsappExecutionResult } from "./ai-reply-whatsapp-executor-core.ts";
import type { WhatsappOutboundDispatchResult } from "./outbound-dispatch-repository-core.ts";
import { buildBookingResultResponse } from "./booking-result-response-core.ts";

export type BookingWhatsappContext = {
  language: "ru" | "kk" | null;
  dispatch: WhatsappOutboundDispatchResult | null;
};
export type AiBookingWhatsappExecutionResult = AiReplyWhatsappExecutionResult | { outcome: "already_executing" | "automation_disabled" };
export type AiBookingWhatsappDependencies = {
  isBookingAutomationAllowed(input: AiReplyWhatsappExecutionInput): Promise<boolean>;
  loadContext(input: AiReplyWhatsappExecutionInput): Promise<BookingWhatsappContext>;
  loadTimeContext(organizationId: string): Promise<BookingTimeContextResult>;
  executeAiBookingAction(input: AiReplyWhatsappExecutionInput): Promise<AiBookingActionExecutionResult>;
  prepareResponse(input: AiReplyWhatsappExecutionInput, text: string): Promise<WhatsappOutboundDispatchResult>;
  executeDispatch(input: AiReplyWhatsappExecutionInput, prepared: WhatsappOutboundDispatchResult): Promise<AiReplyWhatsappExecutionResult>;
};

export async function executeAiBookingWhatsappWithDependencies(
  input: AiReplyWhatsappExecutionInput,
  dependencies: AiBookingWhatsappDependencies,
): Promise<AiBookingWhatsappExecutionResult> {
  try {
    const identity = { organizationId: input.organizationId, aiMessageRunId: input.aiMessageRunId };
    if (!await dependencies.isBookingAutomationAllowed(identity)) return { outcome: "automation_disabled" };
    const context = await dependencies.loadContext(identity);
    // Recovery uses the immutable prepared text, without CRM, locale lookup or
    // another booking call. The existing outbound executor owns every send.
    if (context.dispatch) return await dependencies.executeDispatch(identity, context.dispatch);
    if (!context.language) throw new Error("Missing language");
    const time = await dependencies.loadTimeContext(identity.organizationId);
    if (!time.success) throw new Error("Missing timezone");
    const result = await dependencies.executeAiBookingAction(identity);
    const text = buildBookingResultResponse(result, { language: context.language, timeZone: time.context.timeZone });
    if (text === null) return { outcome: "already_executing" };
    const prepared = await dependencies.prepareResponse(identity, text);
    return await dependencies.executeDispatch(identity, prepared);
  } catch {
    throw new Error("Booking WhatsApp execution failed.");
  }
}
