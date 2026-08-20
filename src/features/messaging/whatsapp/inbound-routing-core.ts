import {
  normalizeWhatsappInboundMessages,
  type NormalizedWhatsappInboundMessage,
} from "../../webhooks/whatsapp/normalize.ts";

import type {
  ResolvedWhatsappConnection,
  WhatsappConnectionInput,
} from "./connection-repository-core.ts";

export type RoutedWhatsappInboundMessage =
  NormalizedWhatsappInboundMessage &
    ResolvedWhatsappConnection;

export type WhatsappConnectionResolver = (
  input: WhatsappConnectionInput,
) => Promise<ResolvedWhatsappConnection | null>;

function connectionCacheKey(message: NormalizedWhatsappInboundMessage): string {
  return JSON.stringify([message.wabaId, message.phoneNumberId]);
}

export async function routeWhatsappInboundMessagesWithResolver(
  payload: unknown,
  resolveConnection: WhatsappConnectionResolver,
): Promise<RoutedWhatsappInboundMessage[]> {
  const normalizedMessages = normalizeWhatsappInboundMessages(payload);
  const connectionCache = new Map<
    string,
    Promise<ResolvedWhatsappConnection | null>
  >();
  const routedMessages: RoutedWhatsappInboundMessage[] = [];

  for (const message of normalizedMessages) {
    const cacheKey = connectionCacheKey(message);
    let connectionPromise = connectionCache.get(cacheKey);

    if (!connectionPromise) {
      connectionPromise = Promise.resolve().then(() =>
        resolveConnection({
          phoneNumberId: message.phoneNumberId,
          wabaId: message.wabaId,
        }),
      );
      connectionCache.set(cacheKey, connectionPromise);
    }

    let connection: ResolvedWhatsappConnection | null;

    try {
      connection = await connectionPromise;
    } catch {
      throw new Error("WhatsApp inbound routing failed.");
    }

    if (!connection) {
      continue;
    }

    routedMessages.push({
      ...message,
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
    });
  }

  return routedMessages;
}
