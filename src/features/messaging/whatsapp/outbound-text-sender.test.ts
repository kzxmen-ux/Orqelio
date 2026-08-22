import assert from "node:assert/strict";
import test from "node:test";

import {
  sendWhatsappTextMessageWithDependencies,
  type WhatsappOutboundFetch,
  type WhatsappTextSenderDependencies,
} from "./outbound-text-sender-core.ts";

const ACCESS_TOKEN = "fixture-meta-system-user-token";
const VALID_INPUT = {
  phoneNumberId: "123456789012345",
  recipientWaId: "77001234567",
  text: "Fixture outbound message",
};
const SAFE_OUTBOUND_ERROR = /^Error: WhatsApp outbound message failed\.$/;
const INVALID_INPUT_ERROR = /^Error: Invalid WhatsApp outbound message\.$/;

function dependencies(
  overrides: Partial<WhatsappTextSenderDependencies> = {},
): WhatsappTextSenderDependencies {
  return {
    fetch: async () =>
      Response.json({ messages: [{ id: "wamid.fixture-provider-id" }] }),
    getAccessToken: () => ACCESS_TOKEN,
    ...overrides,
  };
}

test("successful send returns the provider message id", async () => {
  const result = await sendWhatsappTextMessageWithDependencies(
    VALID_INPUT,
    dependencies(),
  );

  assert.deepEqual(result, {
    providerMessageId: "wamid.fixture-provider-id",
  });
});

test("sends the exact Meta endpoint, authorization, and text request shape", async () => {
  const exactText = "  Line one\nLine two  ";
  let fetchWasCalled = false;
  const fetchMock: WhatsappOutboundFetch = async (input, init) => {
    fetchWasCalled = true;
    const headers = new Headers(init.headers);

    assert.equal(
      input,
      "https://graph.facebook.com/v26.0/123456789012345/messages",
    );
    assert.equal(init.method, "POST");
    assert.equal(headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init.body)), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      text: { body: exactText },
      to: "77001234567",
      type: "text",
    });

    return Response.json({ messages: [{ id: "wamid.exact-request" }] });
  };

  await sendWhatsappTextMessageWithDependencies(
    { ...VALID_INPUT, text: exactText },
    dependencies({ fetch: fetchMock }),
  );
  assert.equal(fetchWasCalled, true);
});

test("rejects invalid phoneNumberId before fetch", async () => {
  for (const phoneNumberId of ["", " ", "meta-phone-id", "+123", "12.3"]) {
    let fetchWasCalled = false;

    await assert.rejects(
      sendWhatsappTextMessageWithDependencies(
        { ...VALID_INPUT, phoneNumberId },
        dependencies({
          fetch: async () => {
            fetchWasCalled = true;
            return Response.json({});
          },
        }),
      ),
      INVALID_INPUT_ERROR,
    );
    assert.equal(fetchWasCalled, false);
  }
});

test("rejects invalid recipientWaId before fetch", async () => {
  for (const recipientWaId of ["", " ", "recipient", "+77001234567"]) {
    let fetchWasCalled = false;

    await assert.rejects(
      sendWhatsappTextMessageWithDependencies(
        { ...VALID_INPUT, recipientWaId },
        dependencies({
          fetch: async () => {
            fetchWasCalled = true;
            return Response.json({});
          },
        }),
      ),
      INVALID_INPUT_ERROR,
    );
    assert.equal(fetchWasCalled, false);
  }
});

test("rejects empty or invalid text before fetch", async () => {
  for (const text of ["", "   ", "\n\t", 123, null]) {
    let fetchWasCalled = false;

    await assert.rejects(
      sendWhatsappTextMessageWithDependencies(
        { ...VALID_INPUT, text },
        dependencies({
          fetch: async () => {
            fetchWasCalled = true;
            return Response.json({});
          },
        }),
      ),
      INVALID_INPUT_ERROR,
    );
    assert.equal(fetchWasCalled, false);
  }
});

test("missing Meta system user token fails safely before fetch", async () => {
  let fetchWasCalled = false;

  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () => {
          fetchWasCalled = true;
          return Response.json({});
        },
        getAccessToken: () => "   ",
      }),
    ),
    SAFE_OUTBOUND_ERROR,
  );
  assert.equal(fetchWasCalled, false);
});

test("network failure becomes a safe generic error", async () => {
  const sensitiveNetworkDetail = "socket failed while sending private text";

  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () => {
          throw new Error(sensitiveNetworkDetail);
        },
      }),
    ),
    SAFE_OUTBOUND_ERROR,
  );
});

test("Meta non-2xx response becomes a safe generic error", async () => {
  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () =>
          Response.json(
            { error: { message: "provider rejected recipient" } },
            { status: 400 },
          ),
      }),
    ),
    SAFE_OUTBOUND_ERROR,
  );
});

test("malformed 2xx responses without one usable message id fail safely", async () => {
  for (const data of [
    null,
    {},
    { messages: [] },
    { messages: [{}] },
    { messages: [{ id: "" }] },
    { messages: [{ id: " first " }] },
    { messages: [{ id: "first" }, { id: "second" }] },
  ]) {
    await assert.rejects(
      sendWhatsappTextMessageWithDependencies(
        VALID_INPUT,
        dependencies({ fetch: async () => Response.json(data) }),
      ),
      SAFE_OUTBOUND_ERROR,
    );
  }
});

test("sensitive Meta response content is not reflected in errors", async () => {
  const sensitiveMarker =
    "fixture-recipient-token-message-and-provider-internal-detail";

  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () =>
          Response.json({ error: sensitiveMarker }, { status: 500 }),
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp outbound message failed.");
      assert.equal(error.message.includes(sensitiveMarker), false);
      assert.equal(error.message.includes(ACCESS_TOKEN), false);
      assert.equal(error.message.includes(VALID_INPUT.recipientWaId), false);
      assert.equal(error.message.includes(VALID_INPUT.text), false);
      return true;
    },
  );
});
