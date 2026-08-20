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
import {
  routeWhatsappInboundMessages,
  type RoutedWhatsappInboundMessage,
} from "./inbound-routing";

const dependencies: WhatsappInboxProcessorDependencies<RoutedWhatsappInboundMessage> =
  {
    claimEvent: claimWhatsappWebhookEvent,
    completeEvent: completeWhatsappWebhookEvent,
    failEvent: failWhatsappWebhookEvent,
    routePayload: routeWhatsappInboundMessages,
    storeMessage: storeRoutedWhatsappInboundMessage,
  };

export function processWhatsappInboxEvent(
  eventId: string,
): Promise<WhatsappInboxProcessorResult> {
  return processWhatsappInboxEventWithDependencies(eventId, dependencies);
}
