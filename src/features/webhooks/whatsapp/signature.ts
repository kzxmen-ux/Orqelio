import "server-only";

import { getMetaAppSecret } from "@/lib/env/server";

import { verifyWhatsappWebhookSignatureWithSecret } from "./signature-core";

export function verifyWhatsappWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null | undefined,
): boolean {
  return verifyWhatsappWebhookSignatureWithSecret(
    rawBody,
    signatureHeader,
    getMetaAppSecret(),
  );
}
