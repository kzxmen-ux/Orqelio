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
import { processAiInboundMessage } from "../../ai-runtime/inbound-processing";
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
    failEvent: failWhatsappWebhookEvent,
    routePayload: routeWhatsappInboundMessages,
    routeStatuses: routeWhatsappDeliveryStatuses,
    storeMessage: storeRoutedWhatsappInboundMessage,
    storeStatus: applyWhatsappDeliveryStatus,
    processAi: processAiInboundMessage,
  };

export function processWhatsappInboxEvent(
  eventId: string,
): Promise<WhatsappInboxProcessorResult> {
  return processWhatsappInboxEventWithDependencies(eventId, dependencies);
}
