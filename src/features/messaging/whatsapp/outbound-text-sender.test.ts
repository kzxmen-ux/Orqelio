import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const PRODUCTION_SENDER_URL = new URL(
  "./outbound-text-sender.ts",
  import.meta.url,
);
const SENDER_CORE_URL = new URL(
  "./outbound-text-sender-core.ts",
  import.meta.url,
);

function dependencies(
  overrides: Partial<WhatsappTextSenderDependencies> = {},
): WhatsappTextSenderDependencies {
  return {
    createTimeoutSignal: () => new AbortController().signal,
    fetch: async () =>
      Response.json({ messages: [{ id: "wamid.fixture-provider-id" }] }),
    getAccessToken: () => ACCESS_TOKEN,
    ...overrides,
  };
}

test("successful send returns the provider message id", async () => {
  let fetchCalls = 0;
  const result = await sendWhatsappTextMessageWithDependencies(
    VALID_INPUT,
    dependencies({
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({
          messages: [{ id: "wamid.fixture-provider-id" }],
        });
      },
    }),
  );

  assert.deepEqual(result, {
    providerMessageId: "wamid.fixture-provider-id",
  });
  assert.equal(fetchCalls, 1);
});

test("attaches the fixed timeout without changing the Meta request contract", async () => {
  const exactText = "  Line one\nLine two  ";
  const timeoutSignal = new AbortController().signal;
  const timeoutValues: number[] = [];
  let fetchCalls = 0;
  const fetchMock: WhatsappOutboundFetch = async (input, init) => {
    fetchCalls += 1;
    const headers = new Headers(init.headers);

    assert.equal(
      input,
      "https://graph.facebook.com/v26.0/123456789012345/messages",
    );
    assert.equal(init.method, "POST");
    assert.equal(headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(init.signal, timeoutSignal);
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
    dependencies({
      createTimeoutSignal: (timeoutMs) => {
        timeoutValues.push(timeoutMs);
        return timeoutSignal;
      },
      fetch: fetchMock,
    }),
  );
  assert.deepEqual(timeoutValues, [15_000]);
  assert.equal(fetchCalls, 1);
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

test("aborted timeout fetch fails safely without a second request", async () => {
  const sensitiveNetworkDetail = "AbortError with private timeout internals";
  let fetchCalls = 0;

  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () => {
          fetchCalls += 1;
          throw new Error(sensitiveNetworkDetail);
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp outbound message failed.");
      assert.equal(error.message.includes(sensitiveNetworkDetail), false);
      return true;
    },
  );
  assert.equal(fetchCalls, 1);
});

test("timeout signal creation failure is safe and prevents fetch", async () => {
  const sensitiveTimeoutDetail = "unsupported timeout signal internals";
  let fetchCalls = 0;

  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        createTimeoutSignal: () => {
          throw new Error(sensitiveTimeoutDetail);
        },
        fetch: async () => {
          fetchCalls += 1;
          return Response.json({});
        },
      }),
    ),
    SAFE_OUTBOUND_ERROR,
  );
  assert.equal(fetchCalls, 0);
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

test("malformed Meta JSON remains a safe generic failure", async () => {
  await assert.rejects(
    sendWhatsappTextMessageWithDependencies(
      VALID_INPUT,
      dependencies({
        fetch: async () =>
          new Response("{malformed", {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
      }),
    ),
    SAFE_OUTBOUND_ERROR,
  );
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

test("production sender uses the native timeout and retains one-fetch delegation", async () => {
  const productionSource = (await readFile(PRODUCTION_SENDER_URL, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();
  const coreSource = (await readFile(SENDER_CORE_URL, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();

  assert.match(
    productionSource,
    /createtimeoutsignal: \(timeoutms\) => abortsignal\.timeout\(timeoutms\)/,
  );
  assert.match(productionSource, /getaccesstoken: getmetasystemusertoken/);
  assert.match(productionSource, /sendwhatsapptextmessagewithdependencies/);
  assert.equal(coreSource.match(/dependencies\.fetch\(/g)?.length, 1);
  assert.doesNotMatch(coreSource, /\bwhile\s*\(|\bfor\s*\(/);
  assert.doesNotMatch(productionSource, /\bwhile\s*\(|\bfor\s*\(/);
});
