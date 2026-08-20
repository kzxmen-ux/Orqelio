import "server-only";

import { resolveWhatsappConnection } from "./connection-repository";
import {
  routeWhatsappInboundMessagesWithResolver,
  type RoutedWhatsappInboundMessage,
} from "./inbound-routing-core";

export type { RoutedWhatsappInboundMessage } from "./inbound-routing-core";

export async function routeWhatsappInboundMessages(
  payload: unknown,
): Promise<RoutedWhatsappInboundMessage[]> {
  return routeWhatsappInboundMessagesWithResolver(
    payload,
    resolveWhatsappConnection,
  );
}
