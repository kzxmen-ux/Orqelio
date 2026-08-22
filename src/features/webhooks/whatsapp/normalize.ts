export type NormalizedWhatsappInboundMessage = {
  wabaId: string;
  phoneNumberId: string;
  messageId: string;
  from: string;
  customerWaId: string | null;
  customerName: string | null;
  timestamp: string;
  type: string;
  text: string | null;
};

export type WhatsappDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type NormalizedWhatsappDeliveryStatus = {
  wabaId: string;
  phoneNumberId: string;
  providerMessageId: string;
  status: WhatsappDeliveryStatus;
  timestamp: string;
};

const DECIMAL_IDENTIFIER_PATTERN = /^[0-9]{1,32}$/;
const PROVIDER_MESSAGE_ID_MAX_LENGTH = 255;
const UNIX_SECONDS_PATTERN = /^[0-9]{1,12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDeliveryStatus(value: unknown): value is WhatsappDeliveryStatus {
  return (
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed"
  );
}

function isValidUnixTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UNIX_SECONDS_PATTERN.test(value)) {
    return false;
  }

  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) && !Number.isNaN(Date.parse(new Date(milliseconds).toISOString()));
}

function findMatchingContact(
  contacts: unknown,
  from: string,
): { customerName: string | null; customerWaId: string | null } {
  if (!Array.isArray(contacts)) {
    return { customerName: null, customerWaId: null };
  }

  for (const contact of contacts) {
    if (!isRecord(contact) || contact.wa_id !== from) {
      continue;
    }

    const profile = contact.profile;
    const customerName =
      isRecord(profile) && typeof profile.name === "string"
        ? profile.name
        : null;

    return { customerName, customerWaId: from };
  }

  return { customerName: null, customerWaId: null };
}

export function normalizeWhatsappInboundMessages(
  payload: unknown,
): NormalizedWhatsappInboundMessage[] {
  if (
    !isRecord(payload) ||
    payload.object !== "whatsapp_business_account" ||
    !Array.isArray(payload.entry)
  ) {
    return [];
  }

  const normalizedMessages: NormalizedWhatsappInboundMessage[] = [];
  const seenMessageIds = new Set<string>();

  for (const entry of payload.entry) {
    if (
      !isRecord(entry) ||
      !isNonEmptyString(entry.id) ||
      !Array.isArray(entry.changes)
    ) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "messages") {
        continue;
      }

      const value = change.value;

      if (
        !isRecord(value) ||
        value.messaging_product !== "whatsapp" ||
        !isRecord(value.metadata) ||
        !isNonEmptyString(value.metadata.phone_number_id) ||
        !Array.isArray(value.messages)
      ) {
        continue;
      }

      for (const message of value.messages) {
        if (
          !isRecord(message) ||
          !isNonEmptyString(message.id) ||
          !isNonEmptyString(message.from) ||
          !isNonEmptyString(message.timestamp) ||
          !isNonEmptyString(message.type) ||
          seenMessageIds.has(message.id)
        ) {
          continue;
        }

        let text: string | null = null;

        if (message.type === "text") {
          if (!isRecord(message.text) || typeof message.text.body !== "string") {
            continue;
          }

          text = message.text.body;
        }

        const contact = findMatchingContact(value.contacts, message.from);

        normalizedMessages.push({
          customerName: contact.customerName,
          customerWaId: contact.customerWaId,
          from: message.from,
          messageId: message.id,
          phoneNumberId: value.metadata.phone_number_id,
          text,
          timestamp: message.timestamp,
          type: message.type,
          wabaId: entry.id,
        });
        seenMessageIds.add(message.id);
      }
    }
  }

  return normalizedMessages;
}

export function normalizeWhatsappDeliveryStatuses(
  payload: unknown,
): NormalizedWhatsappDeliveryStatus[] {
  if (
    !isRecord(payload) ||
    payload.object !== "whatsapp_business_account" ||
    !Array.isArray(payload.entry)
  ) {
    return [];
  }

  const normalizedStatuses: NormalizedWhatsappDeliveryStatus[] = [];
  const seenEvents = new Set<string>();

  for (const entry of payload.entry) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !DECIMAL_IDENTIFIER_PATTERN.test(entry.id) ||
      !Array.isArray(entry.changes)
    ) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "messages") {
        continue;
      }

      const value = change.value;

      if (
        !isRecord(value) ||
        value.messaging_product !== "whatsapp" ||
        !isRecord(value.metadata) ||
        typeof value.metadata.phone_number_id !== "string" ||
        !DECIMAL_IDENTIFIER_PATTERN.test(value.metadata.phone_number_id) ||
        !Array.isArray(value.statuses)
      ) {
        continue;
      }

      for (const providerStatus of value.statuses) {
        if (
          !isRecord(providerStatus) ||
          typeof providerStatus.id !== "string" ||
          providerStatus.id.length === 0 ||
          providerStatus.id.length > PROVIDER_MESSAGE_ID_MAX_LENGTH ||
          providerStatus.id !== providerStatus.id.trim() ||
          !isDeliveryStatus(providerStatus.status) ||
          !isValidUnixTimestamp(providerStatus.timestamp)
        ) {
          continue;
        }

        const deduplicationKey = JSON.stringify([
          entry.id,
          value.metadata.phone_number_id,
          providerStatus.id,
          providerStatus.status,
          providerStatus.timestamp,
        ]);

        if (seenEvents.has(deduplicationKey)) {
          continue;
        }

        normalizedStatuses.push({
          phoneNumberId: value.metadata.phone_number_id,
          providerMessageId: providerStatus.id,
          status: providerStatus.status,
          timestamp: providerStatus.timestamp,
          wabaId: entry.id,
        });
        seenEvents.add(deduplicationKey);
      }
    }
  }

  return normalizedStatuses;
}
