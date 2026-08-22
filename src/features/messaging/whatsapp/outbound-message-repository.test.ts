import assert from "node:assert/strict";
import test from "node:test";

import {
  storeWhatsappOutboundMessageWithRpc,
  type WhatsappOutboundMessagePersistenceInput,
} from "./outbound-message-repository-core.ts";

const ORGANIZATION_ID = "b818f38f-55f9-40ee-a5ee-fb2b32de3ef3";
const CONNECTION_ID = "1633a4ba-3900-422c-bf93-7b88492b9261";
const CONVERSATION_ID = "550001eb-3011-4300-85a2-4f731306d82c";
const MESSAGE_ID = "63cb0538-c1f8-4ddd-a7cc-80c52c57fae4";

function validInput(
  overrides: Partial<WhatsappOutboundMessagePersistenceInput> = {},
): WhatsappOutboundMessagePersistenceInput {
  return {
    connectionId: CONNECTION_ID,
    conversationId: CONVERSATION_ID,
    organizationId: ORGANIZATION_ID,
    providerMessageId: "wamid.fixture-outbound-message",
    textContent: "Fixture outbound text",
    ...overrides,
  };
}

test("stores an accepted outbound message with the exact RPC input", async () => {
  const exactText = "  Line one\nLine two  ";
  let receivedInput: WhatsappOutboundMessagePersistenceInput | undefined;

  const result = await storeWhatsappOutboundMessageWithRpc(
    validInput({ textContent: exactText }),
    async (input) => {
      receivedInput = input;
      return {
        data: [{ message_id: MESSAGE_ID, outcome: "accepted" }],
        error: null,
      };
    },
  );

  assert.deepEqual(receivedInput, validInput({ textContent: exactText }));
  assert.deepEqual(result, { messageId: MESSAGE_ID, outcome: "accepted" });
});

test("normalizes duplicate persistence as success", async () => {
  const result = await storeWhatsappOutboundMessageWithRpc(
    validInput(),
    async () => ({
      data: [{ message_id: MESSAGE_ID, outcome: "duplicate" }],
      error: null,
    }),
  );

  assert.deepEqual(result, { messageId: MESSAGE_ID, outcome: "duplicate" });
});

test("rejects invalid inputs before calling the RPC", async () => {
  const invalidInputs: unknown[] = [
    validInput({ organizationId: "wrong-organization" }),
    validInput({ connectionId: "wrong-connection" }),
    validInput({ conversationId: "wrong-conversation" }),
    validInput({ providerMessageId: "" }),
    validInput({ providerMessageId: " provider-id " }),
    validInput({ providerMessageId: "x".repeat(256) }),
    validInput({ textContent: "" }),
    validInput({ textContent: " \n\t " }),
    { ...validInput(), textContent: null },
  ];

  for (const input of invalidInputs) {
    let rpcWasCalled = false;

    await assert.rejects(
      storeWhatsappOutboundMessageWithRpc(input, async () => {
        rpcWasCalled = true;
        return { data: null, error: null };
      }),
      new Error("Invalid WhatsApp outbound message persistence input."),
    );
    assert.equal(rpcWasCalled, false);
  }
});

test("malformed RPC results fail safely", async () => {
  for (const data of [
    null,
    [],
    [{}],
    [{ message_id: "not-a-uuid", outcome: "accepted" }],
    [{ message_id: MESSAGE_ID, outcome: "unexpected" }],
    [
      { message_id: MESSAGE_ID, outcome: "accepted" },
      { message_id: MESSAGE_ID, outcome: "duplicate" },
    ],
  ]) {
    await assert.rejects(
      storeWhatsappOutboundMessageWithRpc(validInput(), async () => ({
        data,
        error: null,
      })),
      new Error("WhatsApp outbound message storage failed."),
    );
  }
});

test("identity and database errors never leak details", async () => {
  const sensitiveMarker =
    "cross-tenant provider identity conflict with raw database detail";

  await assert.rejects(
    storeWhatsappOutboundMessageWithRpc(validInput(), async () => ({
      data: null,
      error: { message: sensitiveMarker, providerMessageId: "private-id" },
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp outbound message storage failed.");
      assert.equal(error.message.includes(sensitiveMarker), false);
      assert.equal(error.message.includes("private-id"), false);
      return true;
    },
  );
});

test("thrown RPC errors are normalized without provider details", async () => {
  const providerDetail = "provider response body and connection identifiers";

  await assert.rejects(
    storeWhatsappOutboundMessageWithRpc(validInput(), async () => {
      throw new Error(providerDetail);
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp outbound message storage failed.");
      assert.equal(error.message.includes(providerDetail), false);
      return true;
    },
  );
});
