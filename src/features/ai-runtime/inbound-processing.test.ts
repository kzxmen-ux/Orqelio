import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  processAiInboundMessageWithDependencies,
  type AiInboundProcessingInput,
} from "./inbound-processing-core.ts";

const INPUT: AiInboundProcessingInput = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  triggerMessageId: "33333333-3333-4333-8333-333333333333",
};

test("passes only the technical identifiers and preserves a reply decision", async () => {
  const receivedInputs: unknown[] = [];

  const result = await processAiInboundMessageWithDependencies(INPUT, {
    runRuntime: async (input) => {
      receivedInputs.push(input);
      return {
        outcome: "decided",
        decision: { action: "reply", text: "Здравствуйте!" },
        model: "test-model",
        usage: null,
      };
    },
  });

  assert.deepEqual(receivedInputs, [INPUT]);
  assert.deepEqual(result, {
    outcome: "decided",
    decision: { action: "reply", text: "Здравствуйте!" },
  });
});

test("preserves booking_action_required as a decision only", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "decided",
        decision: {
          action: "booking_action_required",
          bookingIntent: "create_appointment",
        },
        model: "test-model",
        usage: null,
      }),
    }),
    {
      outcome: "decided",
      decision: {
        action: "booking_action_required",
        bookingIntent: "create_appointment",
      },
    },
  );
});

test("preserves handoff as a decision only", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "decided",
        decision: {
          action: "handoff",
          reasonCode: "customer_requested_human",
          safeReason: "The customer requested a person.",
        },
        model: "test-model",
        usage: null,
      }),
    }),
    {
      outcome: "decided",
      decision: {
        action: "handoff",
        reasonCode: "customer_requested_human",
        safeReason: "The customer requested a person.",
      },
    },
  );
});

test("represents blocked AI configuration with its safe reason", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "blocked",
        reason: "ai_configuration_missing",
      }),
    }),
    { outcome: "blocked", reason: "ai_configuration_missing" },
  );
});

test("represents an AI runtime failure with its safe reason", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "failure",
        reason: "provider_error",
      }),
    }),
    { outcome: "failed", reason: "provider_error" },
  );
});

test("normalizes an unexpected runtime exception without leaking details", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => {
        throw new Error("raw provider response and customer data");
      },
    }),
    { outcome: "failed", reason: "runtime_error" },
  );
});

test("production orchestration contains no outbound, Meta, or CRM sender", async () => {
  const sourceUrls = [
    new URL("./inbound-processing.ts", import.meta.url),
    new URL("../messaging/whatsapp/inbox-processor.ts", import.meta.url),
  ];
  const sources = (await Promise.all(
    sourceUrls.map((url) => readFile(url, "utf8")),
  )).join("\n");

  for (const forbidden of [
    "sendWhatsappConversationText",
    "MetaWhatsAppProvider",
    "outbound-message",
    "outbound-text",
    "integrations/crm",
  ]) {
    assert.equal(sources.includes(forbidden), false);
  }
});
