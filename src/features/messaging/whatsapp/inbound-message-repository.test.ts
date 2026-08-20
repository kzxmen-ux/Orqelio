import assert from "node:assert/strict";
import test from "node:test";

import type { RoutedWhatsappInboundMessage } from "./inbound-routing-core.ts";
import {
  prepareWhatsappInboundPersistenceInput,
  storeRoutedWhatsappInboundMessageWithRpc,
} from "./inbound-message-repository-core.ts";

function routedMessage(
  overrides: Partial<RoutedWhatsappInboundMessage> = {},
): RoutedWhatsappInboundMessage {
  return {
    connectionId: "fixture-connection-id",
    customerName: "Fixture Contact",
    customerWaId: "444444444444444",
    from: "333333333333333",
    messageId: "fixture-provider-message-id",
    organizationId: "fixture-organization-id",
    phoneNumberId: "222222222222222",
    text: "Fixture inbound text",
    timestamp: "1700000000",
    type: "text",
    wabaId: "111111111111111",
    ...overrides,
  };
}

test("converts a valid routed text message to persistence input", () => {
  assert.deepEqual(prepareWhatsappInboundPersistenceInput(routedMessage()), {
    connectionId: "fixture-connection-id",
    displayName: "Fixture Contact",
    externalParticipantId: "444444444444444",
    messageType: "text",
    organizationId: "fixture-organization-id",
    phoneNumberId: "222222222222222",
    providerMessageId: "fixture-provider-message-id",
    providerTimestamp: "2023-11-14T22:13:20.000Z",
    senderExternalId: "333333333333333",
    textContent: "Fixture inbound text",
    wabaId: "111111111111111",
  });
});

test("prefers customerWaId over from for the participant identity", () => {
  const input = prepareWhatsappInboundPersistenceInput(routedMessage());

  assert.equal(input?.externalParticipantId, "444444444444444");
  assert.equal(input?.senderExternalId, "333333333333333");
});

test("uses from when customerWaId is null", () => {
  const input = prepareWhatsappInboundPersistenceInput(
    routedMessage({ customerWaId: null }),
  );

  assert.equal(input?.externalParticipantId, "333333333333333");
});

test("preserves exact customer text including whitespace and empty text", () => {
  const exactText = "  Fixture line one\nFixture line two  ";
  const whitespaceInput = prepareWhatsappInboundPersistenceInput(
    routedMessage({ text: exactText }),
  );
  const emptyInput = prepareWhatsappInboundPersistenceInput(
    routedMessage({ text: "" }),
  );

  assert.equal(whitespaceInput?.textContent, exactText);
  assert.equal(emptyInput?.textContent, "");
});

test("stores null text for a non-text message", () => {
  const input = prepareWhatsappInboundPersistenceInput(
    routedMessage({ text: "ignored fixture caption", type: "image" }),
  );

  assert.equal(input?.messageType, "image");
  assert.equal(input?.textContent, null);
});

test("converts valid Unix seconds to an ISO timestamptz input", () => {
  const input = prepareWhatsappInboundPersistenceInput(
    routedMessage({ timestamp: "1700000001" }),
  );

  assert.equal(input?.providerTimestamp, "2023-11-14T22:13:21.000Z");
});

test("rejects invalid timestamps before executing the RPC", async () => {
  for (const timestamp of ["", "not-a-timestamp", "1.5", "9".repeat(30)]) {
    let rpcWasCalled = false;

    await assert.rejects(
      storeRoutedWhatsappInboundMessageWithRpc(
        routedMessage({ timestamp }),
        async () => {
          rpcWasCalled = true;
          return { data: [], error: null };
        },
      ),
      new Error("Invalid WhatsApp inbound message."),
    );
    assert.equal(rpcWasCalled, false);
  }
});

test("rejects an invalid participant identifier before executing the RPC", async () => {
  let rpcWasCalled = false;

  await assert.rejects(
    storeRoutedWhatsappInboundMessageWithRpc(
      routedMessage({ customerWaId: "invalid participant" }),
      async () => {
        rpcWasCalled = true;
        return { data: [], error: null };
      },
    ),
    new Error("Invalid WhatsApp inbound message."),
  );
  assert.equal(rpcWasCalled, false);
});

test("rejects invalid routing and required identifiers before the RPC", async () => {
  const invalidMessages = [
    routedMessage({ organizationId: "" }),
    routedMessage({ connectionId: "" }),
    routedMessage({ messageId: "" }),
    routedMessage({ wabaId: "fixture-waba" }),
    routedMessage({ phoneNumberId: "fixture-phone" }),
    routedMessage({ from: "fixture-sender" }),
    routedMessage({ type: "" }),
  ];

  for (const message of invalidMessages) {
    let rpcWasCalled = false;

    await assert.rejects(
      storeRoutedWhatsappInboundMessageWithRpc(message, async () => {
        rpcWasCalled = true;
        return { data: [], error: null };
      }),
      new Error("Invalid WhatsApp inbound message."),
    );
    assert.equal(rpcWasCalled, false);
  }
});

test("normalizes an accepted RPC result", async () => {
  const result = await storeRoutedWhatsappInboundMessageWithRpc(
    routedMessage(),
    async () => ({
      data: [
        {
          conversation_id: "fixture-conversation-id",
          message_id: "fixture-message-id",
          outcome: "accepted",
        },
      ],
      error: null,
    }),
  );

  assert.deepEqual(result, {
    conversationId: "fixture-conversation-id",
    messageId: "fixture-message-id",
    outcome: "accepted",
  });
});

test("normalizes a duplicate RPC result", async () => {
  const result = await storeRoutedWhatsappInboundMessageWithRpc(
    routedMessage(),
    async () => ({
      data: [
        {
          conversation_id: "fixture-existing-conversation-id",
          message_id: "fixture-existing-message-id",
          outcome: "duplicate",
        },
      ],
      error: null,
    }),
  );

  assert.deepEqual(result, {
    conversationId: "fixture-existing-conversation-id",
    messageId: "fixture-existing-message-id",
    outcome: "duplicate",
  });
});

test("malformed RPC results throw a safe error", async () => {
  for (const data of [
    null,
    [],
    [{}],
    [
      {
        conversation_id: "fixture-conversation-id",
        message_id: null,
        outcome: "accepted",
      },
    ],
  ]) {
    await assert.rejects(
      storeRoutedWhatsappInboundMessageWithRpc(routedMessage(), async () => ({
        data,
        error: null,
      })),
      new Error("WhatsApp inbound message storage failed."),
    );
  }
});

test("database errors throw safely without leaking details", async () => {
  const sensitiveMarker = "fixture-sensitive-database-detail";

  await assert.rejects(
    storeRoutedWhatsappInboundMessageWithRpc(routedMessage(), async () => ({
      data: null,
      error: { message: sensitiveMarker },
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp inbound message storage failed.");
      assert.equal(error.message.includes(sensitiveMarker), false);
      return true;
    },
  );
});
