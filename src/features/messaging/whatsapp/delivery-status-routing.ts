import "server-only";

import { resolveWhatsappConnection } from "./connection-repository";
import {
  routeWhatsappDeliveryStatusesWithResolver,
  type RoutedWhatsappDeliveryStatus,
} from "./delivery-status-routing-core";

export type { RoutedWhatsappDeliveryStatus } from "./delivery-status-routing-core";

export function routeWhatsappDeliveryStatuses(
  payload: unknown,
): Promise<RoutedWhatsappDeliveryStatus[]> {
  return routeWhatsappDeliveryStatusesWithResolver(
    payload,
    resolveWhatsappConnection,
  );
}
