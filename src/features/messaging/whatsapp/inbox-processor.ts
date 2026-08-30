import "server-only";

import {
  claimWhatsappWebhookEvent,
  completeWhatsappWebhookEvent,
  failWhatsappWebhookEvent,
} from "./inbox-repository";
import {
  processWhatsappInboxEventWithDependencies,
  type WhatsappInboxProcessorDependencies,
  type WhatsappInboxProcessorResult,
} from "./inbox-processor-core";
import { storeRoutedWhatsappInboundMessage } from "./inbound-message-repository";
import { applyWhatsappDeliveryStatus } from "./delivery-status-repository";
import { processDurableAiInboundMessage } from "../../ai-runtime/durable-inbound-processing";
import { executeAiReplyWhatsapp } from "./ai-reply-whatsapp-executor";
import { executeAiBookingWhatsapp } from "./ai-booking-whatsapp-executor";
import {
  routeWhatsappDeliveryStatuses,
  type RoutedWhatsappDeliveryStatus,
} from "./delivery-status-routing";
import {
  routeWhatsappInboundMessages,
  type RoutedWhatsappInboundMessage,
} from "./inbound-routing";

const dependencies: WhatsappInboxProcessorDependencies<
  RoutedWhatsappInboundMessage,
  RoutedWhatsappDeliveryStatus
> = {
    claimEvent: claimWhatsappWebhookEvent,
    completeEvent: completeWhatsappWebhookEvent,
    executeImmediateReply: executeAiReplyWhatsapp,
    executeImmediateBooking: executeAiBookingWhatsapp,
    failEvent: failWhatsappWebhookEvent,
    routePayload: routeWhatsappInboundMessages,
    routeStatuses: routeWhatsappDeliveryStatuses,
    storeMessage: storeRoutedWhatsappInboundMessage,
    storeStatus: applyWhatsappDeliveryStatus,
    processDurableAi: processDurableAiInboundMessage,
  };

export function processWhatsappInboxEvent(
  eventId: string,
): Promise<WhatsappInboxProcessorResult> {
  return processWhatsappInboxEventWithDependencies(eventId, dependencies);
}
