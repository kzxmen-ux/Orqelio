import { handleWhatsappWebhookVerification } from "@/features/webhooks/whatsapp/verification";
import { getWhatsappWebhookVerifyToken } from "@/lib/env/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleWhatsappWebhookVerification(request, {
    getVerificationToken: getWhatsappWebhookVerifyToken,
  });
}
