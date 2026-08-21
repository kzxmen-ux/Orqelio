import { after } from "next/server";

import { processWhatsappInboxEvent } from "@/features/messaging/whatsapp/inbox-processor";
import { handleWhatsappWebhook } from "@/features/webhooks/whatsapp/handler";
import { storeWhatsappWebhookEvent } from "@/features/webhooks/whatsapp/repository";
import { verifyWhatsappWebhookSignature } from "@/features/webhooks/whatsapp/signature";
import { handleWhatsappWebhookVerification } from "@/features/webhooks/whatsapp/verification";
import { getWhatsappWebhookVerifyToken } from "@/lib/env/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function scheduleWhatsappInboxProcessing(eventId: string): void {
  after(async () => {
    try {
      await processWhatsappInboxEvent(eventId);
    } catch {
      // The webhook has already been durably acknowledged.
    }
  });
}

export function GET(request: Request): Response {
  return handleWhatsappWebhookVerification(request, {
    getVerificationToken: getWhatsappWebhookVerifyToken,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleWhatsappWebhook(request, {
    scheduleProcessing: scheduleWhatsappInboxProcessing,
    storeEvent: storeWhatsappWebhookEvent,
    verifySignature: verifyWhatsappWebhookSignature,
  });
}
