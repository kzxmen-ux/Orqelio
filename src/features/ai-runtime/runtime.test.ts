import assert from "node:assert/strict";
import test from "node:test";

import { buildHandoffPolicy } from "../handoff-policy/policy.ts";
import type {
  ConversationAiContext,
  ConversationAiContextInput,
  ConversationAiContextResult,
} from "./conversation-context-core.ts";
import type { ModelProposal } from "./decision-types.ts";
import type {
  OpenAiTransportResult,
  OpenAiTransportUsage,
} from "./openai-transport-core.ts";
import {
  runAiRuntimeWithDependencies,
  type AiRuntimeDependencies,
} from "./runtime-core.ts";

const INPUT: ConversationAiContextInput = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000002",
  triggerMessageId: "00000000-0000-4000-8000-000000000003",
};

const POLICY_CONFIGURATION = {
  organizationId: INPUT.organizationId,
  primaryLanguage: "ru",
  formality: "formal",
  communicationStyle: "friendly",
  rawBusinessContext: "PRIVATE_BUSINESS_CONTEXT",
  status: "ready",
  version: 1,
  handoff: {
    clientRequestsAdmin: true,
    aiUncertain: true,
    bookingError: true,
    customerComplaint: true,
    medicalQuestion: true,
    paymentDispute: true,
    otherCases: "Escalate special cases.",
  },
} as const;

const CONTEXT: ConversationAiContext = {
  organizationId: INPUT.organizationId,
  conversationId: INPUT.conversationId,
  triggerMessageId: INPUT.triggerMessageId,
  organization: { name: "Orqelio Test" },
  aiManager: {
    primaryLanguage: "ru",
    formality: "formal",
    communicationStyle: "friendly",
    businessContext: "PRIVATE_BUSINESS_CONTEXT",
    configurationVersion: 1,
  },
  handoffPolicy: buildHandoffPolicy(
    INPUT.organizationId,
    POLICY_CONFIGURATION,
  ),
  messages: [
    {
      role: "customer",
      text: "PRIVATE_CUSTOMER_TEXT",
      createdAt: "2026-08-24T10:00:00.000Z",
    },
  ],
};

const USAGE: OpenAiTransportUsage = {
  inputTokens: 120,
  outputTokens: 30,
  totalTokens: 150,
  cachedInputTokens: 20,
};

function success(
  proposal: ModelProposal,
  usage: OpenAiTransportUsage | null = USAGE,
): OpenAiTransportResult {
  return {
    outcome: "success",
    proposal,
    model: "gpt-5.6-luna",
    usage,
  };
}

function dependencies(
  contextResult: ConversationAiContextResult,
  transportResult: OpenAiTransportResult,
  onProposalRequest: () => void = () => undefined,
): AiRuntimeDependencies {
  return {
    loadContext: async () => contextResult,
    requestModelProposal: async () => {
      onProposalRequest();
      return transportResult;
    },
  };
}

const READY: ConversationAiContextResult = {
  outcome: "ready",
  context: CONTEXT,
};

test("returns a decided reply for a ready context and valid reply proposal", async () => {
  const result = await runAiRuntimeWithDependencies(
    INPUT,
    dependencies(
      READY,
      success({
        responseIntent: "reply",
        replyText: "Здравствуйте!",
        bookingIntent: "none",
        handoffTrigger: "none",
      }),
    ),
  );

  assert.deepEqual(result, {
    outcome: "decided",
    decision: { action: "reply", text: "Здравствуйте!" },
    model: "gpt-5.6-luna",
    usage: USAGE,
  });
});

test("preserves booking_action_required from the deterministic decision", async () => {
  const result = await runAiRuntimeWithDependencies(
    INPUT,
    dependencies(
      READY,
      success({
        responseIntent: "booking_action_required",
        replyText: null,
        bookingIntent: "create_appointment",
        handoffTrigger: "none",
      }),
    ),
  );

  assert.equal(result.outcome, "decided");
  if (result.outcome !== "decided") return;
  assert.deepEqual(result.decision, {
    action: "booking_action_required",
    bookingIntent: "create_appointment",
  });
});

test("preserves a mandatory handoff decision", async () => {
  const result = await runAiRuntimeWithDependencies(
    INPUT,
    dependencies(
      READY,
      success({
        responseIntent: "handoff_candidate",
        replyText: null,
        bookingIntent: "none",
        handoffTrigger: "customer_requests_human",
      }),
    ),
  );

  assert.equal(result.outcome, "decided");
  if (result.outcome !== "decided") return;
  assert.equal(result.decision.action, "handoff");
});

test("preserves no_safe_answer without orchestration fallback text", async () => {
  const result = await runAiRuntimeWithDependencies(
    INPUT,
    dependencies(
      READY,
      success({
        responseIntent: "cannot_answer",
        replyText: null,
        bookingIntent: "none",
        handoffTrigger: "none",
      }),
    ),
  );

  assert.equal(result.outcome, "decided");
  if (result.outcome !== "decided") return;
  assert.deepEqual(result.decision, {
    action: "no_safe_answer",
    reason: "model_cannot_answer",
  });
});

for (const reason of [
  "ai_configuration_missing",
  "ai_configuration_not_ready",
] as const) {
  test(`returns blocked ${reason} without requesting a proposal`, async () => {
    let proposalRequests = 0;
    const result = await runAiRuntimeWithDependencies(
      INPUT,
      dependencies(
        { outcome: "blocked", reason },
        { outcome: "failure", reason: "provider_error" },
        () => {
          proposalRequests += 1;
        },
      ),
    );

    assert.deepEqual(result, { outcome: "blocked", reason });
    assert.equal(proposalRequests, 0);
    assert.equal("model" in result, false);
    assert.equal("usage" in result, false);
  });
}

for (const reason of [
  "timeout",
  "provider_error",
  "invalid_model_output",
  "incomplete_response",
  "configuration_missing",
] as const) {
  test(`preserves safe transport failure ${reason}`, async () => {
    const result = await runAiRuntimeWithDependencies(
      INPUT,
      dependencies(READY, { outcome: "failure", reason }),
    );

    assert.deepEqual(result, { outcome: "failure", reason });
    assert.equal("model" in result, false);
    assert.equal("usage" in result, false);
  });
}

test("maps an unexpected context-loader exception to runtime_error", async () => {
  const result = await runAiRuntimeWithDependencies(INPUT, {
    loadContext: async () => {
      throw new Error("PRIVATE_CONTEXT_ERROR");
    },
    requestModelProposal: async () =>
      success({
        responseIntent: "reply",
        replyText: "unused",
        bookingIntent: "none",
        handoffTrigger: "none",
      }),
  });

  assert.deepEqual(result, { outcome: "failure", reason: "runtime_error" });
  assert.equal(JSON.stringify(result).includes("PRIVATE_CONTEXT_ERROR"), false);
});

test("maps an unexpected proposal-requester exception to runtime_error", async () => {
  const result = await runAiRuntimeWithDependencies(INPUT, {
    loadContext: async () => READY,
    requestModelProposal: async () => {
      throw new Error("PRIVATE_PROVIDER_ERROR");
    },
  });

  assert.deepEqual(result, { outcome: "failure", reason: "runtime_error" });
  assert.equal(JSON.stringify(result).includes("PRIVATE_PROVIDER_ERROR"), false);
});

test("returns only safe decision metadata and omits context and provider details", async () => {
  const result = await runAiRuntimeWithDependencies(
    INPUT,
    dependencies(
      READY,
      success(
        {
          responseIntent: "reply",
          replyText: "Безопасный ответ",
          bookingIntent: "none",
          handoffTrigger: "none",
        },
        null,
      ),
    ),
  );

  assert.deepEqual(result, {
    outcome: "decided",
    decision: { action: "reply", text: "Безопасный ответ" },
    model: "gpt-5.6-luna",
    usage: null,
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    INPUT.organizationId,
    INPUT.conversationId,
    INPUT.triggerMessageId,
    "PRIVATE_CUSTOMER_TEXT",
    "PRIVATE_BUSINESS_CONTEXT",
    "prompt",
    "responseId",
    "providerId",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
