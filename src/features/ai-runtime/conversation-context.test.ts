import assert from "node:assert/strict";
import test from "node:test";

import {
  loadConversationAiContextWithDependencies,
  type ConversationAiContextDependencies,
} from "./conversation-context-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const TRIGGER_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const TRIGGER_CREATED_AT = "2026-08-23T12:00:00.000Z";
const INPUT = {
  conversationId: CONVERSATION_ID,
  organizationId: ORGANIZATION_ID,
  triggerMessageId: TRIGGER_MESSAGE_ID,
};

function messageId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function readyConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    communication_style: "friendly",
    formality: "informal",
    handoff_ai_uncertain: true,
    handoff_booking_error: false,
    handoff_client_requests_admin: true,
    handoff_customer_complaint: true,
    handoff_medical_question: true,
    handoff_other_cases: "Escalate special requests",
    handoff_payment_dispute: true,
    organization_id: ORGANIZATION_ID,
    primary_language: "ru",
    raw_business_context: "Business context",
    status: "ready",
    version: 7,
    ...overrides,
  };
}

function historyMessage(index: number, overrides: Record<string, unknown> = {}) {
  return {
    created_at: new Date(
      Date.parse(TRIGGER_CREATED_AT) - index * 1_000,
    ).toISOString(),
    delivery_status: "received",
    direction: "inbound",
    id: messageId(index),
    text_content: `message-${index}`,
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<ConversationAiContextDependencies> = {},
): ConversationAiContextDependencies {
  return {
    loadAiManagerConfiguration: async () => ({
      data: [readyConfiguration()],
      error: null,
    }),
    loadConversation: async () => ({
      data: [
        {
          channel: "whatsapp",
          connection: {
            id: CONNECTION_ID,
            organization_id: ORGANIZATION_ID,
            status: "active",
          },
          id: CONVERSATION_ID,
          organization_id: ORGANIZATION_ID,
        },
      ],
      error: null,
    }),
    loadOrganization: async () => ({
      data: [{ id: ORGANIZATION_ID, name: "Orqelio Test Business" }],
      error: null,
    }),
    loadRecentMessages: async () => ({
      data: [
        historyMessage(0, {
          created_at: TRIGGER_CREATED_AT,
          id: TRIGGER_MESSAGE_ID,
          text_content: "Trigger text",
        }),
      ],
      error: null,
    }),
    loadTriggerMessage: async () => ({
      data: [
        {
          channel: "whatsapp",
          conversation_id: CONVERSATION_ID,
          created_at: TRIGGER_CREATED_AT,
          direction: "inbound",
          id: TRIGGER_MESSAGE_ID,
          message_type: "text",
          organization_id: ORGANIZATION_ID,
          text_content: "Trigger text",
        },
      ],
      error: null,
    }),
    ...overrides,
  };
}

test("valid tenant and inbound trigger return a bounded ready context", async () => {
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies(),
  );

  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;

  assert.equal(result.context.organizationId, ORGANIZATION_ID);
  assert.equal(result.context.conversationId, CONVERSATION_ID);
  assert.equal(result.context.triggerMessageId, TRIGGER_MESSAGE_ID);
  assert.deepEqual(result.context.organization, { name: "Orqelio Test Business" });
  assert.deepEqual(result.context.messages, [
    { createdAt: TRIGGER_CREATED_AT, role: "customer", text: "Trigger text" },
  ]);
});

test("wrong organization cannot load another tenant conversation", async () => {
  await assert.rejects(
    loadConversationAiContextWithDependencies(
      INPUT,
      createDependencies({
        loadConversation: async () => ({
          data: [
            {
              channel: "whatsapp",
              connection: {
                id: CONNECTION_ID,
                organization_id: OTHER_ORGANIZATION_ID,
                status: "active",
              },
              id: CONVERSATION_ID,
              organization_id: OTHER_ORGANIZATION_ID,
            },
          ],
          error: null,
        }),
      }),
    ),
    /Conversation AI context could not be loaded\./,
  );
});

test("wrong conversation cannot load trigger message", async () => {
  const dependencies = createDependencies();
  const original = dependencies.loadTriggerMessage;
  dependencies.loadTriggerMessage = async (input) => {
    const result = await original(input);
    const row = (result.data as Record<string, unknown>[])[0];
    return {
      data: [
        {
          ...row,
          conversation_id: "55555555-5555-4555-8555-555555555555",
        },
      ],
      error: null,
    };
  };

  await assert.rejects(
    loadConversationAiContextWithDependencies(INPUT, dependencies),
  );
});

test("outbound and non-text triggers are rejected", async (t) => {
  for (const invalidField of [
    { direction: "outbound" },
    { message_type: "image" },
  ]) {
    await t.test(JSON.stringify(invalidField), async () => {
      const dependencies = createDependencies();
      const original = dependencies.loadTriggerMessage;
      dependencies.loadTriggerMessage = async (input) => {
        const result = await original(input);
        const row = (result.data as Record<string, unknown>[])[0];
        return { data: [{ ...row, ...invalidField }], error: null };
      };
      await assert.rejects(
        loadConversationAiContextWithDependencies(INPUT, dependencies),
      );
    });
  }
});

test("inactive WhatsApp connection is rejected", async () => {
  const dependencies = createDependencies();
  const original = dependencies.loadConversation;
  dependencies.loadConversation = async (input) => {
    const result = await original(input);
    const row = (result.data as Record<string, unknown>[])[0];
    return {
      data: [
        {
          ...row,
          connection: {
            id: CONNECTION_ID,
            organization_id: ORGANIZATION_ID,
            status: "suspended",
          },
        },
      ],
      error: null,
    };
  };
  await assert.rejects(
    loadConversationAiContextWithDependencies(INPUT, dependencies),
  );
});

test("missing configuration blocks without loading history", async () => {
  let historyCalls = 0;
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadAiManagerConfiguration: async () => ({ data: [], error: null }),
      loadRecentMessages: async () => {
        historyCalls += 1;
        return { data: [], error: null };
      },
    }),
  );
  assert.deepEqual(result, {
    outcome: "blocked",
    reason: "ai_configuration_missing",
  });
  assert.equal(historyCalls, 0);
});

test("draft configuration blocks as not ready", async () => {
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadAiManagerConfiguration: async () => ({
        data: [readyConfiguration({ status: "draft" })],
        error: null,
      }),
    }),
  );
  assert.deepEqual(result, {
    outcome: "blocked",
    reason: "ai_configuration_not_ready",
  });
});

test("ready configuration and existing handoff policy map exactly", async () => {
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies(),
  );
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;

  assert.deepEqual(result.context.aiManager, {
    businessContext: "Business context",
    communicationStyle: "friendly",
    configurationVersion: 7,
    formality: "informal",
    primaryLanguage: "ru",
  });
  assert.equal(result.context.handoffPolicy.policyVersion, 7);
  assert.equal(
    result.context.handoffPolicy.organizationRules.aiCannotUnderstand,
    true,
  );
  assert.equal(
    result.context.handoffPolicy.organizationRules.bookingError,
    false,
  );
  assert.equal(
    result.context.handoffPolicy.organizationRules.customInstructions,
    "Escalate special requests",
  );
});

test("history maps roles, excludes failed outbound and is chronological", async () => {
  const dependencies = createDependencies({
    loadRecentMessages: async () => ({
      data: [
        historyMessage(0, {
          created_at: TRIGGER_CREATED_AT,
          id: TRIGGER_MESSAGE_ID,
          text_content: "trigger",
        }),
        historyMessage(1, {
          delivery_status: "delivered",
          direction: "outbound",
          text_content: "assistant",
        }),
        historyMessage(2, { text_content: "customer" }),
        historyMessage(3, {
          delivery_status: "failed",
          direction: "outbound",
          text_content: "failed-secret",
        }),
      ],
      error: null,
    }),
  });
  dependencies.loadTriggerMessage = async () => ({
    data: [
      {
        channel: "whatsapp",
        conversation_id: CONVERSATION_ID,
        created_at: TRIGGER_CREATED_AT,
        direction: "inbound",
        id: TRIGGER_MESSAGE_ID,
        message_type: "text",
        organization_id: ORGANIZATION_ID,
        text_content: "trigger",
      },
    ],
    error: null,
  });

  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    dependencies,
  );
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.deepEqual(
    result.context.messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "customer", text: "customer" },
      { role: "assistant", text: "assistant" },
      { role: "customer", text: "trigger" },
    ],
  );
});

test("history keeps newest 30 messages and retains trigger", async () => {
  const history = Array.from({ length: 35 }, (_, index) =>
    historyMessage(index + 1),
  );
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadRecentMessages: async () => ({ data: history, error: null }),
    }),
  );
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.equal(result.context.messages.length, 30);
  assert.equal(
    result.context.messages.some((message) => message.text === "Trigger text"),
    true,
  );
  assert.equal(
    result.context.messages.some((message) => message.text === "message-35"),
    false,
  );
});

test("12,000-character budget drops oldest messages first", async () => {
  const oldest = "o".repeat(5_000);
  const middle = "m".repeat(5_000);
  const newest = "n".repeat(5_000);
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadRecentMessages: async () => ({
        data: [
          historyMessage(1, { text_content: newest }),
          historyMessage(2, { text_content: middle }),
          historyMessage(3, { text_content: oldest }),
        ],
        error: null,
      }),
    }),
  );
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  const texts = result.context.messages.map((message) => message.text);
  assert.equal(texts.includes(oldest), false);
  assert.equal(texts.includes(middle), true);
  assert.equal(texts.includes(newest), true);
  assert.equal(texts.includes("Trigger text"), true);
  assert.ok(texts.reduce((total, text) => total + text.length, 0) <= 12_000);
});

test("messages after trigger are excluded", async () => {
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadRecentMessages: async () => ({
        data: [
          historyMessage(1),
          historyMessage(99, {
            created_at: "2026-08-23T12:00:01.000Z",
            text_content: "future message",
          }),
        ],
        error: null,
      }),
    }),
  );
  assert.equal(result.outcome, "ready");
  if (result.outcome !== "ready") return;
  assert.equal(
    result.context.messages.some((message) => message.text === "future message"),
    false,
  );
});

test("returned context strips provider and customer routing identifiers", async () => {
  const result = await loadConversationAiContextWithDependencies(
    INPUT,
    createDependencies({
      loadRecentMessages: async () => ({
        data: [
          {
            ...historyMessage(1),
            external_participant_id: "sensitive-customer",
            phone_number_id: "sensitive-phone",
            provider_message_id: "sensitive-provider",
            sender_external_id: "sensitive-sender",
            waba_id: "sensitive-waba",
          },
        ],
        error: null,
      }),
    }),
  );
  const serialized = JSON.stringify(result);
  for (const sensitiveValue of [
    "sensitive-customer",
    "sensitive-phone",
    "sensitive-provider",
    "sensitive-sender",
    "sensitive-waba",
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test("raw database failures become one generic safe error", async () => {
  const sensitiveDetail = "raw database secret detail";
  await assert.rejects(
    loadConversationAiContextWithDependencies(
      INPUT,
      createDependencies({
        loadOrganization: async () => {
          throw new Error(sensitiveDetail);
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Conversation AI context could not be loaded.");
      assert.equal(error.message.includes(sensitiveDetail), false);
      return true;
    },
  );
});
