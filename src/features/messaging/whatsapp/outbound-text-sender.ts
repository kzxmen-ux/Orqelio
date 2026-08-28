import "server-only";

import { getMetaSystemUserToken } from "@/lib/env/server";

import {
  sendWhatsappTextMessageWithDependencies,
  type WhatsappTextMessageInput,
  type WhatsappTextMessageResult,
} from "./outbound-text-sender-core";

export function sendWhatsappTextMessage(
  input: WhatsappTextMessageInput,
): Promise<WhatsappTextMessageResult> {
  return sendWhatsappTextMessageWithDependencies(input, {
    createTimeoutSignal: (timeoutMs) => AbortSignal.timeout(timeoutMs),
    fetch,
    getAccessToken: getMetaSystemUserToken,
  });
}
