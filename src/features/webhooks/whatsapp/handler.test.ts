import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { handleWhatsappWebhook } from "./handler.ts";
import { verifyWhatsappWebhookSignatureWithSecret } from "./signature-core.ts";

const APP_SECRET = "test-meta-app-secret";
const VALID_JSON = JSON.stringify({
  entry: [{ changes: [] }],
  object: "whatsapp_business_account",
});

function signatureFor(rawBody: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
}

function requestFor(
  rawBody: string,
  signatureHeader: string | null = signatureFor(rawBody),
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (signatureHeader !== null) {
    headers.set("X-Hub-Signature-256", signatureHeader);
  }

  return new Request("https://example.test/api/webhooks/whatsapp", {
    body: rawBody,
    headers,
    method: "POST",
  });
}

function verifier(rawBody: Uint8Array, signatureHeader: string | null): boolean {
  return verifyWhatsappWebhookSignatureWithSecret(
    rawBody,
    signatureHeader,
    APP_SECRET,
  );
}

test("valid signed Meta envelope is stored before a 200 ACK", async () => {
  let storedPayload: Record<string, unknown> | undefined;
  const response = await handleWhatsappWebhook(requestFor(VALID_JSON), {
    storeEvent: async (payload) => {
      storedPayload = payload;
      return { eventId: crypto.randomUUID(), outcome: "accepted" };
    },
    verifySignature: verifier,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { duplicate: false, ok: true });
  assert.deepEqual(storedPayload, JSON.parse(VALID_JSON));
});

test("duplicate event receives a successful idempotent ACK", async () => {
  const response = await handleWhatsappWebhook(requestFor(VALID_JSON), {
    storeEvent: async () => ({
      eventId: crypto.randomUUID(),
      outcome: "duplicate",
    }),
    verifySignature: verifier,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { duplicate: true, ok: true });
});

test("missing signature returns 401 without storing", async () => {
  let storeWasCalled = false;
  const response = await handleWhatsappWebhook(requestFor(VALID_JSON, null), {
    storeEvent: async () => {
      storeWasCalled = true;
      return { eventId: crypto.randomUUID(), outcome: "accepted" };
    },
    verifySignature: verifier,
  });

  assert.equal(response.status, 401);
  assert.equal(storeWasCalled, false);
});

test("invalid signature returns 401", async () => {
  const invalidSignature = `sha256=${"0".repeat(64)}`;
  const response = await handleWhatsappWebhook(
    requestFor(VALID_JSON, invalidSignature),
    {
      storeEvent: async () => {
        assert.fail("store must not be called");
      },
      verifySignature: verifier,
    },
  );

  assert.equal(response.status, 401);
});

test("body modified after signature generation returns 401", async () => {
  const signedBody = VALID_JSON;
  const modifiedBody = VALID_JSON.replace("changes", "statuses");
  const response = await handleWhatsappWebhook(
    requestFor(modifiedBody, signatureFor(signedBody)),
    {
      storeEvent: async () => {
        assert.fail("store must not be called");
      },
      verifySignature: verifier,
    },
  );

  assert.equal(response.status, 401);
});

test("correctly signed invalid JSON returns 400 after raw verification", async () => {
  const invalidJson = "{not-json";
  let verifiedBytes: Uint8Array | undefined;
  const response = await handleWhatsappWebhook(requestFor(invalidJson), {
    storeEvent: async () => {
      assert.fail("store must not be called");
    },
    verifySignature: (rawBody, signatureHeader) => {
      verifiedBytes = rawBody;
      return verifier(rawBody, signatureHeader);
    },
  });

  assert.equal(response.status, 400);
  assert.equal(new TextDecoder().decode(verifiedBytes), invalidJson);
  assert.deepEqual(await response.json(), { error: "invalid_json", ok: false });
});

test("wrong Meta object returns 400", async () => {
  const rawBody = JSON.stringify({ entry: [], object: "page" });
  const response = await handleWhatsappWebhook(requestFor(rawBody), {
    storeEvent: async () => {
      assert.fail("store must not be called");
    },
    verifySignature: verifier,
  });

  assert.equal(response.status, 400);
});

test("missing or non-array entry returns 400", async (context) => {
  for (const payload of [
    { object: "whatsapp_business_account" },
    { entry: {}, object: "whatsapp_business_account" },
  ]) {
    await context.test(JSON.stringify(payload), async () => {
      const rawBody = JSON.stringify(payload);
      const response = await handleWhatsappWebhook(requestFor(rawBody), {
        storeEvent: async () => {
          assert.fail("store must not be called");
        },
        verifySignature: verifier,
      });

      assert.equal(response.status, 400);
    });
  }
});

test("actual body larger than 256 KiB returns 413", async () => {
  const rawBody = "x".repeat(256 * 1024 + 1);
  let verificationWasCalled = false;
  const response = await handleWhatsappWebhook(requestFor(rawBody, null), {
    storeEvent: async () => {
      assert.fail("store must not be called");
    },
    verifySignature: () => {
      verificationWasCalled = true;
      return true;
    },
  });

  assert.equal(response.status, 413);
  assert.equal(verificationWasCalled, false);
});

test("repository failure returns 503 and never ACKs early", async () => {
  const response = await handleWhatsappWebhook(requestFor(VALID_JSON), {
    storeEvent: async () => {
      throw new Error("database offline");
    },
    verifySignature: verifier,
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "temporarily_unavailable",
    ok: false,
  });
});

test("error responses do not reflect secrets, signatures, or raw bodies", async () => {
  const rawMarker = "customer-private-body-marker";
  const secretMarker = "database-secret-marker";
  const signatureMarker = `sha256=${"f".repeat(64)}`;
  const rawBody = JSON.stringify({
    entry: [],
    marker: rawMarker,
    object: "whatsapp_business_account",
  });
  const response = await handleWhatsappWebhook(
    requestFor(rawBody, signatureMarker),
    {
      storeEvent: async () => {
        throw new Error(secretMarker);
      },
      verifySignature: () => true,
    },
  );
  const responseBody = await response.text();

  assert.equal(response.status, 503);
  assert.equal(responseBody.includes(rawMarker), false);
  assert.equal(responseBody.includes(secretMarker), false);
  assert.equal(responseBody.includes(signatureMarker), false);
});
