import {
  normalizeWhatsappDeliveryStatuses,
  type WhatsappDeliveryStatus,
} from "../../webhooks/whatsapp/normalize.ts";

type ResolvedConnection = {
  connectionId: string;
  organizationId: string;
};

export type RoutedWhatsappDeliveryStatus = {
  organizationId: string;
  connectionId: string;
  providerMessageId: string;
  status: WhatsappDeliveryStatus;
  providerTimestamp: string;
};

export type WhatsappDeliveryStatusConnectionResolver = (input: {
  wabaId: string;
  phoneNumberId: string;
}) => Promise<ResolvedConnection | null>;

function toProviderTimestamp(unixSeconds: string): string {
  return new Date(Number(unixSeconds) * 1_000).toISOString();
}

export async function routeWhatsappDeliveryStatusesWithResolver(
  payload: unknown,
  resolveConnection: WhatsappDeliveryStatusConnectionResolver,
): Promise<RoutedWhatsappDeliveryStatus[]> {
  const normalizedStatuses = normalizeWhatsappDeliveryStatuses(payload);
  const resolvedConnections = new Map<string, ResolvedConnection | null>();
  const routedStatuses: RoutedWhatsappDeliveryStatus[] = [];

  for (const normalizedStatus of normalizedStatuses) {
    const connectionKey = JSON.stringify([
      normalizedStatus.wabaId,
      normalizedStatus.phoneNumberId,
    ]);
    let connection = resolvedConnections.get(connectionKey);

    if (connection === undefined) {
      connection = await resolveConnection({
        phoneNumberId: normalizedStatus.phoneNumberId,
        wabaId: normalizedStatus.wabaId,
      });
      resolvedConnections.set(connectionKey, connection);
    }

    if (connection === null) {
      continue;
    }

    routedStatuses.push({
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      providerMessageId: normalizedStatus.providerMessageId,
      providerTimestamp: toProviderTimestamp(normalizedStatus.timestamp),
      status: normalizedStatus.status,
    });
  }

  return routedStatuses;
}
