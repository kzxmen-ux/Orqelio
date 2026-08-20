import assert from "node:assert/strict";
import test from "node:test";

import {
  routeWhatsappInboundMessagesWithResolver,
  type WhatsappConnectionResolver,
} from "./inbound-routing-core.ts";

const CONNECTION_ID = "fixture-connection-id";
const ORGANIZATION_ID = "fixture-organization-id";
const PHONE_NUMBER_ID = "222222222222222";
const SENDER_ID = "333333333333333";
const WABA_ID = "111111111111111";

function textMessage(
  id: string,
  text = "Fixture inbound text",
): Record<string, unknown> {
  return {
    from: SENDER_ID,
    id,
    text: { body: text },
    timestamp: "1700000000",
    type: "text",
  };
}

function messagesChange(
  phoneNumberId: string,
  messages: unknown[],
): Record<string, unknown> {
  return {
    field: "messages",
    value: {
      contacts: [
        {
          profile: { name: "Fixture Contact" },
          wa_id: SENDER_ID,
        },
      ],
      messaging_product: "whatsapp",
      metadata: { phone_number_id: phoneNumberId },
      messages,
    },
  };
}

function payloadWithEntries(entries: unknown[]): Record<string, unknown> {
  return {
    entry: entries,
    object: "whatsapp_business_account",
  };
}

function entry(
  wabaId: string,
  changes: unknown[],
): Record<string, unknown> {
  return { changes, id: wabaId };
}

const MAPPED_CONNECTION = {
  connectionId: CONNECTION_ID,
  organizationId: ORGANIZATION_ID,
};

const singleMessagePayload = payloadWithEntries([
  entry(WABA_ID, [
    messagesChange(PHONE_NUMBER_ID, [textMessage("fixture-message-one")]),
  ]),
]);

test("routes one normalized message and attaches connection ownership", async () => {
  const routed = await routeWhatsappInboundMessagesWithResolver(
    singleMessagePayload,
    async () => MAPPED_CONNECTION,
  );

  assert.deepEqual(routed, [
    {
      connectionId: CONNECTION_ID,
      customerName: "Fixture Contact",
      customerWaId: SENDER_ID,
      from: SENDER_ID,
      messageId: "fixture-message-one",
      organizationId: ORGANIZATION_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      text: "Fixture inbound text",
      timestamp: "1700000000",
      type: "text",
      wabaId: WABA_ID,
    },
  ]);
});

test("preserves every normalized message field exactly", async () => {
  const exactText = "  Fixture line one\nFixture line two  ";
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange(PHONE_NUMBER_ID, [
        {
          ...textMessage("fixture-preserved-message", exactText),
          timestamp: "1700000001",
        },
      ]),
    ]),
  ]);
  const [routed] = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async () => MAPPED_CONNECTION,
  );

  assert.deepEqual(
    {
      customerName: routed?.customerName,
      customerWaId: routed?.customerWaId,
      from: routed?.from,
      messageId: routed?.messageId,
      phoneNumberId: routed?.phoneNumberId,
      text: routed?.text,
      timestamp: routed?.timestamp,
      type: routed?.type,
      wabaId: routed?.wabaId,
    },
    {
      customerName: "Fixture Contact",
      customerWaId: SENDER_ID,
      from: SENDER_ID,
      messageId: "fixture-preserved-message",
      phoneNumberId: PHONE_NUMBER_ID,
      text: exactText,
      timestamp: "1700000001",
      type: "text",
      wabaId: WABA_ID,
    },
  );
});

test("skips an unmapped connection", async () => {
  const routed = await routeWhatsappInboundMessagesWithResolver(
    singleMessagePayload,
    async () => null,
  );

  assert.deepEqual(routed, []);
});

test("an unmapped message does not remove another mapped message", async () => {
  const mappedPhoneNumberId = "444444444444444";
  const unmappedPhoneNumberId = "555555555555555";
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange(unmappedPhoneNumberId, [
        textMessage("fixture-unmapped-message"),
      ]),
      messagesChange(mappedPhoneNumberId, [
        textMessage("fixture-mapped-message"),
      ]),
    ]),
  ]);
  const routed = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async ({ phoneNumberId }) =>
      phoneNumberId === mappedPhoneNumberId ? MAPPED_CONNECTION : null,
  );

  assert.deepEqual(routed.map((message) => message.messageId), [
    "fixture-mapped-message",
  ]);
});

test("reuses one resolver call for one exact WABA and phone pair", async () => {
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange(PHONE_NUMBER_ID, [
        textMessage("fixture-message-one"),
        textMessage("fixture-message-two"),
        textMessage("fixture-message-three"),
      ]),
    ]),
  ]);
  let resolverCalls = 0;
  const routed = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async () => {
      resolverCalls += 1;
      return MAPPED_CONNECTION;
    },
  );

  assert.equal(resolverCalls, 1);
  assert.equal(routed.length, 3);
});

test("caches an unmapped result for one exact pair", async () => {
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange(PHONE_NUMBER_ID, [
        textMessage("fixture-unmapped-one"),
        textMessage("fixture-unmapped-two"),
      ]),
    ]),
  ]);
  let resolverCalls = 0;
  const routed = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async () => {
      resolverCalls += 1;
      return null;
    },
  );

  assert.equal(resolverCalls, 1);
  assert.deepEqual(routed, []);
});

test("different WABA or phone pairs cause separate resolver calls", async () => {
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange("444444444444444", [textMessage("fixture-message-a")]),
      messagesChange("555555555555555", [textMessage("fixture-message-b")]),
    ]),
    entry("666666666666666", [
      messagesChange("444444444444444", [textMessage("fixture-message-c")]),
    ]),
  ]);
  const resolvedPairs: string[] = [];
  const resolver: WhatsappConnectionResolver = async (input) => {
    resolvedPairs.push(`${input.wabaId}:${input.phoneNumberId}`);
    return MAPPED_CONNECTION;
  };

  await routeWhatsappInboundMessagesWithResolver(payload, resolver);

  assert.deepEqual(resolvedPairs, [
    `${WABA_ID}:444444444444444`,
    `${WABA_ID}:555555555555555`,
    "666666666666666:444444444444444",
  ]);
});

test("resolver null represents inactive connections and is skipped", async () => {
  for (const inactiveStatus of ["suspended", "disconnected"]) {
    const routed = await routeWhatsappInboundMessagesWithResolver(
      singleMessagePayload,
      async () => {
        assert.ok(inactiveStatus);
        return null;
      },
    );

    assert.deepEqual(routed, []);
  }
});

test("resolver failure propagates as a safe retryable routing error", async () => {
  const sensitiveMarker = "fixture-sensitive-database-detail";

  await assert.rejects(
    routeWhatsappInboundMessagesWithResolver(
      singleMessagePayload,
      async () => {
        throw new Error(sensitiveMarker);
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp inbound routing failed.");
      assert.equal(error.message.includes(sensitiveMarker), false);
      assert.equal(error.message.includes(WABA_ID), false);
      assert.equal(error.message.includes(PHONE_NUMBER_ID), false);
      return true;
    },
  );
});

test("invalid or unrelated payload returns an empty array", async () => {
  for (const payload of [null, {}, [], { entry: [], object: "page" }]) {
    let resolverWasCalled = false;
    const routed = await routeWhatsappInboundMessagesWithResolver(
      payload,
      async () => {
        resolverWasCalled = true;
        return MAPPED_CONNECTION;
      },
    );

    assert.deepEqual(routed, []);
    assert.equal(resolverWasCalled, false);
  }
});

test("preserves normalized input order across mapped pairs", async () => {
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange("444444444444444", [textMessage("fixture-first")]),
      messagesChange("555555555555555", [textMessage("fixture-second")]),
      messagesChange("444444444444444", [textMessage("fixture-third")]),
    ]),
  ]);
  const routed = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async ({ phoneNumberId }) => ({
      connectionId: `connection-${phoneNumberId}`,
      organizationId: `organization-${phoneNumberId}`,
    }),
  );

  assert.deepEqual(routed.map((message) => message.messageId), [
    "fixture-first",
    "fixture-second",
    "fixture-third",
  ]);
});

test("does not reintroduce message IDs deduplicated by the normalizer", async () => {
  const payload = payloadWithEntries([
    entry(WABA_ID, [
      messagesChange(PHONE_NUMBER_ID, [
        textMessage("fixture-duplicate"),
        textMessage("fixture-duplicate"),
      ]),
    ]),
  ]);
  const routed = await routeWhatsappInboundMessagesWithResolver(
    payload,
    async () => MAPPED_CONNECTION,
  );

  assert.deepEqual(routed.map((message) => message.messageId), [
    "fixture-duplicate",
  ]);
});
