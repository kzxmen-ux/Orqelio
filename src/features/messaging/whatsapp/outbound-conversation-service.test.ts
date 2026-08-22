import assert from "node:assert/strict";
import test from "node:test";

import {
  sendWhatsappConversationTextWithDependencies,
  type WhatsappOutboundConversationDependencies,
} from "./outbound-conversation-service-core.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const phoneNumberId = "1234567890";
const recipientWaId = "77001234567";
const providerMessageId = "wamid.provider-message";
const messageId = "44444444-4444-4444-8444-444444444444";
const text = "  Exact reply text  ";

const activeConversation = {
  id: conversationId,
  organization_id: organizationId,
  channel: "whatsapp",
  external_participant_id: recipientWaId,
  connection: {
    id: connectionId,
    organization_id: organizationId,
    status: "active",
    phone_number_id: phoneNumberId,
  },
};

function createDependencies(
  overrides: Partial<WhatsappOutboundConversationDependencies> = {},
): WhatsappOutboundConversationDependencies {
  return {
    lookupConversation: async () => ({
      data: [activeConversation],
      error: null,
    }),
    sendTextMessage: async () => ({ providerMessageId }),
    storeOutboundMessage: async () => ({
      outcome: "accepted",
      messageId,
    }),
    ...overrides,
  };
}

test("looks up, sends, then persists an outbound conversation reply", async () => {
  const calls: string[] = [];
  const dependencies = createDependencies({
    lookupConversation: async (input) => {
      calls.push("lookup");
      assert.deepEqual(input, { organizationId, conversationId });
      return { data: [activeConversation], error: null };
    },
    sendTextMessage: async (input) => {
      calls.push("send");
      assert.deepEqual(input, { phoneNumberId, recipientWaId, text });
      return { providerMessageId };
    },
    storeOutboundMessage: async (input) => {
      calls.push("persist");
      assert.deepEqual(input, {
        organizationId,
        connectionId,
        conversationId,
        providerMessageId,
        textContent: text,
      });
      return { outcome: "accepted", messageId };
    },
  });

  const result = await sendWhatsappConversationTextWithDependencies(
    { organizationId, conversationId, text },
    dependencies,
  );

  assert.deepEqual(calls, ["lookup", "send", "persist"]);
  assert.deepEqual(result, {
    providerMessageId,
    messageId,
    persistenceOutcome: "accepted",
  });
});

test("caller cannot override provider routing identifiers", async () => {
  let sentInput: unknown;
  const callerInput = {
    organizationId,
    conversationId,
    text,
    phoneNumberId: "999",
    recipientWaId: "888",
    connectionId: "55555555-5555-4555-8555-555555555555",
    providerMessageId: "caller-controlled",
  };

  await sendWhatsappConversationTextWithDependencies(callerInput, {
    ...createDependencies(),
    sendTextMessage: async (input) => {
      sentInput = input;
      return { providerMessageId };
    },
  });

  assert.deepEqual(sentInput, { phoneNumberId, recipientWaId, text });
});

test("rejects wrong organization before sending", async () => {
  let sendCalls = 0;
  const dependencies = createDependencies({
    lookupConversation: async () => ({
      data: [
        {
          ...activeConversation,
          organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
      error: null,
    }),
    sendTextMessage: async () => {
      sendCalls += 1;
      return { providerMessageId };
    },
  });

  await assert.rejects(
    sendWhatsappConversationTextWithDependencies(
      { organizationId, conversationId, text },
      dependencies,
    ),
    /WhatsApp outbound conversation is unavailable/,
  );
  assert.equal(sendCalls, 0);
});

for (const scenario of [
  { name: "missing", connection: null },
  {
    name: "inactive",
    connection: { ...activeConversation.connection, status: "suspended" },
  },
  {
    name: "mismatched",
    connection: {
      ...activeConversation.connection,
      organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  },
]) {
  test(`${scenario.name} connection is rejected before sending`, async () => {
    let sendCalls = 0;
    const dependencies = createDependencies({
      lookupConversation: async () => ({
        data: [{ ...activeConversation, connection: scenario.connection }],
        error: null,
      }),
      sendTextMessage: async () => {
        sendCalls += 1;
        return { providerMessageId };
      },
    });

    await assert.rejects(
      sendWhatsappConversationTextWithDependencies(
        { organizationId, conversationId, text },
        dependencies,
      ),
      /WhatsApp outbound conversation is unavailable/,
    );
    assert.equal(sendCalls, 0);
  });
}

test("invalid input is rejected before database lookup", async () => {
  for (const input of [
    { organizationId: "invalid", conversationId, text },
    { organizationId, conversationId: "invalid", text },
    { organizationId, conversationId, text: "   " },
  ]) {
    let lookupCalls = 0;
    const dependencies = createDependencies({
      lookupConversation: async () => {
        lookupCalls += 1;
        return { data: [activeConversation], error: null };
      },
    });

    await assert.rejects(
      sendWhatsappConversationTextWithDependencies(input, dependencies),
      /Invalid WhatsApp outbound request/,
    );
    assert.equal(lookupCalls, 0);
  }
});

test("Meta failure prevents persistence", async () => {
  let persistenceCalls = 0;
  const dependencies = createDependencies({
    sendTextMessage: async () => {
      throw new Error("raw Meta failure with recipient and token");
    },
    storeOutboundMessage: async () => {
      persistenceCalls += 1;
      return { outcome: "accepted", messageId };
    },
  });

  await assert.rejects(
    sendWhatsappConversationTextWithDependencies(
      { organizationId, conversationId, text },
      dependencies,
    ),
    /^Error: WhatsApp outbound conversation service failed$/,
  );
  assert.equal(persistenceCalls, 0);
});

test("persistence failure is safe and does not retry Meta", async () => {
  let sendCalls = 0;
  const sensitive = "database-secret recipient 77001234567 exact text";
  const dependencies = createDependencies({
    sendTextMessage: async () => {
      sendCalls += 1;
      return { providerMessageId };
    },
    storeOutboundMessage: async () => {
      throw new Error(sensitive);
    },
  });

  let thrown: unknown;
  try {
    await sendWhatsappConversationTextWithDependencies(
      { organizationId, conversationId, text },
      dependencies,
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(sendCalls, 1);
  assert.ok(thrown instanceof Error);
  assert.equal(thrown.message, "WhatsApp outbound conversation service failed");
  assert.equal(thrown.message.includes(sensitive), false);
  assert.equal(thrown.message.includes(recipientWaId), false);
  assert.equal(thrown.message.includes(text), false);
});

test("duplicate persistence is returned as success", async () => {
  const result = await sendWhatsappConversationTextWithDependencies(
    { organizationId, conversationId, text },
    createDependencies({
      storeOutboundMessage: async () => ({
        outcome: "duplicate",
        messageId,
      }),
    }),
  );

  assert.equal(result.persistenceOutcome, "duplicate");
  assert.equal(result.messageId, messageId);
});
