import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleWhatsappWebhookVerification } from "./verification.ts";

const verificationToken = "fixture-verification-token";

function request(parameters: Record<string, string | undefined>): Request {
  const url = new URL("https://orqelio.example/api/webhooks/whatsapp");

  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }

  return new Request(url);
}

function verify(
  parameters: Record<string, string | undefined>,
  getVerificationToken: () => string = () => verificationToken,
): Response {
  return handleWhatsappWebhookVerification(request(parameters), {
    getVerificationToken,
  });
}

const validParameters = {
  "hub.challenge": "challenge-value-123",
  "hub.mode": "subscribe",
  "hub.verify_token": verificationToken,
};

describe("WhatsApp webhook verification", () => {
  test("returns the exact challenge for a valid Meta verification request", async () => {
    const response = verify(validParameters);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), validParameters["hub.challenge"]);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("rejects an incorrect token", async () => {
    const response = verify({
      ...validParameters,
      "hub.verify_token": "incorrect-token",
    });

    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes(verificationToken), false);
  });

  test("rejects a missing token", () => {
    const response = verify({
      ...validParameters,
      "hub.verify_token": undefined,
    });

    assert.equal(response.status, 403);
  });

  test("rejects an incorrect mode", () => {
    const response = verify({ ...validParameters, "hub.mode": "unsubscribe" });

    assert.equal(response.status, 403);
  });

  test("rejects a missing mode", () => {
    const response = verify({ ...validParameters, "hub.mode": undefined });

    assert.equal(response.status, 403);
  });

  test("rejects a missing challenge", () => {
    const response = verify({ ...validParameters, "hub.challenge": undefined });

    assert.equal(response.status, 403);
  });

  test("rejects an empty challenge", () => {
    const response = verify({ ...validParameters, "hub.challenge": "" });

    assert.equal(response.status, 403);
  });

  test("returns a safe 503 when the server environment is unavailable", async () => {
    const response = verify(validParameters, () => {
      throw new Error(`Missing ${verificationToken}`);
    });
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.equal(body.includes(verificationToken), false);
    assert.equal(body.includes("Missing"), false);
  });

  test("never returns the verification token", async () => {
    for (const response of [
      verify(validParameters),
      verify({ ...validParameters, "hub.verify_token": "wrong" }),
      verify(validParameters, () => {
        throw new Error(verificationToken);
      }),
    ]) {
      assert.equal((await response.text()).includes(verificationToken), false);
    }
  });
});
