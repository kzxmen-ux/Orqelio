import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, test } from "node:test";

import { verifyWhatsappWebhookSignatureWithSecret } from "./signature-core.ts";

const appSecret = "fixture-meta-app-secret";
const rawBody = new TextEncoder().encode('{"fixture":"payload"}');

function signature(body: Uint8Array, secret: string = appSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("WhatsApp webhook signature verification", () => {
  test("accepts a valid HMAC-SHA256 signature", () => {
    assert.equal(
      verifyWhatsappWebhookSignatureWithSecret(
        rawBody,
        signature(rawBody),
        appSecret,
      ),
      true,
    );
  });

  test("rejects a signature for a modified body", () => {
    const modifiedBody = new TextEncoder().encode('{"fixture":"changed"}');

    assert.equal(
      verifyWhatsappWebhookSignatureWithSecret(
        modifiedBody,
        signature(rawBody),
        appSecret,
      ),
      false,
    );
  });

  test("rejects a signature created with another secret", () => {
    assert.equal(
      verifyWhatsappWebhookSignatureWithSecret(
        rawBody,
        signature(rawBody, "another-fixture-secret"),
        appSecret,
      ),
      false,
    );
  });

  test("rejects a missing signature header", () => {
    assert.equal(
      verifyWhatsappWebhookSignatureWithSecret(rawBody, null, appSecret),
      false,
    );
  });

  test("rejects a malformed signature prefix", () => {
    assert.equal(
      verifyWhatsappWebhookSignatureWithSecret(
        rawBody,
        signature(rawBody).replace("sha256=", "sha1="),
        appSecret,
      ),
      false,
    );
  });

  test("rejects malformed, non-hex, and wrong-length digests", () => {
    for (const header of [
      "sha256=not-hex",
      `sha256=${"g".repeat(64)}`,
      `sha256=${"a".repeat(63)}`,
      `sha256=${"a".repeat(65)}`,
    ]) {
      assert.equal(
        verifyWhatsappWebhookSignatureWithSecret(rawBody, header, appSecret),
        false,
      );
    }
  });
});
