import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWhatsappDeliveryStatuses,
  normalizeWhatsappInboundMessages,
} from "./normalize.ts";

const MESSAGE_ID = "fixture-message-id";
const PHONE_NUMBER_ID = "fixture-phone-number-id";
const SENDER_ID = "fixture-sender-id";
const TIMESTAMP = "1700000000";
const WABA_ID = "fixture-waba-id";
const STATUS_PHONE_NUMBER_ID = "123456789";
const STATUS_WABA_ID = "987654321";

function textMessage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    from: SENDER_ID,
    id: MESSAGE_ID,
    text: { body: "Fixture customer text" },
    timestamp: TIMESTAMP,
    type: "text",
    ...overrides,
  };
}

function messagesChange(
  messages: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    field: "messages",
    value: {
      contacts: [
        {
          profile: { name: "Fixture Customer" },
          wa_id: SENDER_ID,
        },
      ],
      messaging_product: "whatsapp",
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      messages,
      ...overrides,
    },
  };
}

function payloadWith(
  entries: unknown[] = [
    { changes: [messagesChange([textMessage()])], id: WABA_ID },
  ],
): Record<string, unknown> {
  return { entry: entries, object: "whatsapp_business_account" };
}

function statusPayload(statuses: unknown[]): Record<string, unknown> {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: STATUS_PHONE_NUMBER_ID },
              statuses,
            },
          },
        ],
        id: STATUS_WABA_ID,
      },
    ],
    object: "whatsapp_business_account",
  };
}

function deliveryStatus(
  status: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "wamid.fixture-provider-message",
    recipient_id: "must-not-be-normalized",
    status,
    timestamp: "1700000000",
    ...overrides,
  };
}

test("normalizes one inbound text message with required Meta identifiers", () => {
  const result = normalizeWhatsappInboundMessages(payloadWith());

  assert.deepEqual(result, [
    {
      customerName: "Fixture Customer",
      customerWaId: SENDER_ID,
      from: SENDER_ID,
      messageId: MESSAGE_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      text: "Fixture customer text",
      timestamp: TIMESTAMP,
      type: "text",
      wabaId: WABA_ID,
    },
  ]);
});

test("normalizes every message across multiple entries and changes", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([textMessage({ id: "fixture-message-a" })]),
          messagesChange([textMessage({ id: "fixture-message-b" })]),
        ],
        id: "fixture-waba-a",
      },
      {
        changes: [
          messagesChange([textMessage({ id: "fixture-message-c" })]),
        ],
        id: "fixture-waba-b",
      },
    ]),
  );

  assert.deepEqual(
    result.map(({ messageId, wabaId }) => ({ messageId, wabaId })),
    [
      { messageId: "fixture-message-a", wabaId: "fixture-waba-a" },
      { messageId: "fixture-message-b", wabaId: "fixture-waba-a" },
      { messageId: "fixture-message-c", wabaId: "fixture-waba-b" },
    ],
  );
});

test("does not assume entry, change, message, or contact index zero", () => {
  const validMessage = textMessage({ id: "fixture-valid-message" });
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      { changes: [], id: "fixture-empty-waba" },
      {
        changes: [
          { field: "statuses", value: {} },
          messagesChange(
            [{ malformed: true }, validMessage],
            {
              contacts: [
                { profile: { name: "Wrong Contact" }, wa_id: "fixture-other" },
                {
                  profile: { name: "Matching Contact" },
                  wa_id: SENDER_ID,
                },
              ],
            },
          ),
        ],
        id: "fixture-target-waba",
      },
    ]),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.messageId, "fixture-valid-message");
  assert.equal(result[0]?.wabaId, "fixture-target-waba");
  assert.equal(result[0]?.customerName, "Matching Contact");
});

test("ignores unrelated fields and non-WhatsApp messaging products", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          { field: "account_update", value: {} },
          messagesChange([textMessage()], { messaging_product: "other" }),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.deepEqual(result, []);
});

test("skips one malformed message without losing another valid message", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([
            textMessage({ from: "" }),
            textMessage({ id: "fixture-valid-message" }),
          ]),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.deepEqual(result.map((message) => message.messageId), [
    "fixture-valid-message",
  ]);
});

test("skips text messages without a string text body", () => {
  for (const text of [undefined, {}, { body: 123 }]) {
    const result = normalizeWhatsappInboundMessages(
      payloadWith([
        {
          changes: [messagesChange([textMessage({ text })])],
          id: WABA_ID,
        },
      ]),
    );

    assert.deepEqual(result, []);
  }
});

test("keeps non-text messages without deep media normalization", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([
            textMessage({ image: { id: "fixture-media-id" }, type: "image" }),
          ]),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.type, "image");
  assert.equal(result[0]?.text, null);
  assert.equal("image" in (result[0] ?? {}), false);
});

test("does not normalize statuses-only changes", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              statuses: [{ id: "fixture-status-id", status: "delivered" }],
            },
          },
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.deepEqual(result, []);
});

test("returns an empty array for malformed or unrelated roots", () => {
  for (const payload of [
    null,
    [],
    {},
    { entry: [], object: "page" },
    { entry: {}, object: "whatsapp_business_account" },
  ]) {
    assert.deepEqual(normalizeWhatsappInboundMessages(payload), []);
  }
});

test("deduplicates an exact message ID within one payload", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([textMessage(), textMessage()]),
          messagesChange([textMessage()]),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.messageId, MESSAGE_ID);
});

test("does not attach a contact that does not match message.from", () => {
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([textMessage()], {
            contacts: [
              {
                profile: { name: "Different Fixture Contact" },
                wa_id: "fixture-different-sender",
              },
            ],
          }),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.equal(result[0]?.customerWaId, null);
  assert.equal(result[0]?.customerName, null);
});

test("preserves customer text exactly, including whitespace and empty text", () => {
  const exactText = "  Fixture line one\nFixture line two  ";
  const result = normalizeWhatsappInboundMessages(
    payloadWith([
      {
        changes: [
          messagesChange([
            textMessage({ id: "fixture-spaced", text: { body: exactText } }),
            textMessage({ id: "fixture-empty", text: { body: "" } }),
          ]),
        ],
        id: WABA_ID,
      },
    ]),
  );

  assert.deepEqual(
    result.map(({ messageId, text }) => ({ messageId, text })),
    [
      { messageId: "fixture-spaced", text: exactText },
      { messageId: "fixture-empty", text: "" },
    ],
  );
});

for (const status of ["sent", "delivered", "read", "failed"] as const) {
  test(`normalizes a valid ${status} delivery status`, () => {
    assert.deepEqual(
      normalizeWhatsappDeliveryStatuses(
        statusPayload([deliveryStatus(status)]),
      ),
      [
        {
          phoneNumberId: STATUS_PHONE_NUMBER_ID,
          providerMessageId: "wamid.fixture-provider-message",
          status,
          timestamp: "1700000000",
          wabaId: STATUS_WABA_ID,
        },
      ],
    );
  });
}

test("normalizes multiple delivery statuses in payload order", () => {
  const result = normalizeWhatsappDeliveryStatuses(
    statusPayload([
      deliveryStatus("sent", { id: "wamid.first" }),
      deliveryStatus("delivered", { id: "wamid.second" }),
      deliveryStatus("read", { id: "wamid.third" }),
    ]),
  );

  assert.deepEqual(
    result.map(({ providerMessageId, status }) => ({
      providerMessageId,
      status,
    })),
    [
      { providerMessageId: "wamid.first", status: "sent" },
      { providerMessageId: "wamid.second", status: "delivered" },
      { providerMessageId: "wamid.third", status: "read" },
    ],
  );
});

test("skips malformed and unsupported delivery statuses", () => {
  const result = normalizeWhatsappDeliveryStatuses(
    statusPayload([
      deliveryStatus("sent", { id: "" }),
      deliveryStatus("sent", { timestamp: "not-a-timestamp" }),
      deliveryStatus("accepted"),
      deliveryStatus("delivered", { id: "wamid.valid" }),
    ]),
  );

  assert.deepEqual(result.map(({ providerMessageId }) => providerMessageId), [
    "wamid.valid",
  ]);
});

test("deduplicates identical delivery status events", () => {
  const status = deliveryStatus("sent");
  const result = normalizeWhatsappDeliveryStatuses(
    statusPayload([status, status]),
  );

  assert.equal(result.length, 1);
});

test("does not normalize recipient, pricing, conversation, or error details", () => {
  const result = normalizeWhatsappDeliveryStatuses(
    statusPayload([
      deliveryStatus("failed", {
        conversation: { id: "private-conversation" },
        errors: [{ message: "private provider error" }],
        pricing: { category: "private-pricing" },
      }),
    ]),
  );

  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0] ?? {}).sort(), [
    "phoneNumberId",
    "providerMessageId",
    "status",
    "timestamp",
    "wabaId",
  ]);
});
