import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PATTERN = /^sha256=([0-9a-fA-F]{64})$/;

export function verifyWhatsappWebhookSignatureWithSecret(
  rawBody: Uint8Array,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const match = SIGNATURE_PATTERN.exec(signatureHeader);

  if (!match) {
    return false;
  }

  const receivedDigest = Buffer.from(match[1], "hex");
  const expectedDigest = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest();

  return (
    receivedDigest.length === expectedDigest.length &&
    timingSafeEqual(receivedDigest, expectedDigest)
  );
}
