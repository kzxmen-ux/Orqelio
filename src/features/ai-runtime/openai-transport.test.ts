import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OPENAI_AI_MODEL,
  resolveOpenAiAiModel,
} from "../../lib/env/openai-core.ts";
import {
  MODEL_PROPOSAL_JSON_SCHEMA,
  OPENAI_DECISION_MAX_RETRIES,
  OPENAI_DECISION_REQUEST_TIMEOUT_MS,
  requestOpenAiModelProposalWithDependencies,
  type OpenAiDecisionRequest,
  type OpenAiTransportDependencies,
} from "./openai-transport-core.ts";
import type { AiDecisionPrompt } from "./prompt-builder.ts";
import {
  MODEL_BOOKING_INTENTS,
  MODEL_HANDOFF_TRIGGERS,
  MODEL_RESPONSE_INTENTS,
} from "./decision-types.ts";

const VALID_PROPOSAL = {
  responseIntent: "reply",
  replyText: "Здравствуйте!",
  bookingIntent: "none",
  handoffTrigger: "none",
} as const;

const PROMPT: AiDecisionPrompt = {
  instructions: "Runtime instructions",
  input: [
    { role: "user", content: "Untrusted business data" },
    { role: "user", content: "Untrusted customer message" },
  ],
};

type ProviderOutcome =
  | { response: unknown }
  | { error: unknown };

function makeHarness(
  outcome: ProviderOutcome,
  options: {
    model?: string;
    timeoutError?: unknown;
  } = {},
): {
  dependencies: OpenAiTransportDependencies;
  getRequest: () => OpenAiDecisionRequest | null;
} {
  let request: OpenAiDecisionRequest | null = null;

  return {
    dependencies: {
      createClient: () => ({
        responses: {
          create: async (value) => {
            request = value;
            if ("error" in outcome) throw outcome.error;
            return outcome.response;
          },
        },
      }),
      getModel: () => options.model ?? DEFAULT_OPENAI_AI_MODEL,
      isTimeoutError: (error) => error === options.timeoutError,
    },
    getRequest: () => request,
  };
}

function completedResponse(
  proposal: unknown = VALID_PROPOSAL,
  usage: unknown = {
    input_tokens: 120,
    output_tokens: 30,
    total_tokens: 150,
    input_tokens_details: { cached_tokens: 40 },
  },
): unknown {
  return {
    status: "completed",
    output_text: JSON.stringify(proposal),
    usage,
  };
}

test("defaults to gpt-5.6-luna and accepts a trimmed server override", () => {
  assert.equal(resolveOpenAiAiModel(undefined), "gpt-5.6-luna");
  assert.equal(resolveOpenAiAiModel("   "), "gpt-5.6-luna");
  assert.equal(
    resolveOpenAiAiModel("  gpt-5.6-terra  "),
    "gpt-5.6-terra",
  );
});

test("uses a 15-second timeout policy and disables SDK retries", () => {
  assert.equal(OPENAI_DECISION_REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(OPENAI_DECISION_MAX_RETRIES, 0);
});

test("builds the bounded Responses API structured-output request", async () => {
  const harness = makeHarness({ response: completedResponse() });

  await requestOpenAiModelProposalWithDependencies(
    PROMPT,
    harness.dependencies,
  );

  const request = harness.getRequest();
  assert.ok(request);
  assert.equal(request.model, "gpt-5.6-luna");
  assert.equal(request.instructions, PROMPT.instructions);
  assert.deepEqual(request.input, PROMPT.input);
  assert.equal(request.store, false);
  assert.deepEqual(request.reasoning, { effort: "low" });
  assert.equal(request.max_output_tokens, 1_200);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(Object.hasOwn(request, "tools"), false);
  assert.equal(Object.hasOwn(request, "metadata"), false);
});

test("schema has exactly four required fields and aligned enums", () => {
  assert.deepEqual(MODEL_PROPOSAL_JSON_SCHEMA.required, [
    "responseIntent",
    "replyText",
    "bookingIntent",
    "handoffTrigger",
  ]);
  assert.equal(MODEL_PROPOSAL_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    MODEL_PROPOSAL_JSON_SCHEMA.properties.responseIntent.enum,
    MODEL_RESPONSE_INTENTS,
  );
  assert.deepEqual(
    MODEL_PROPOSAL_JSON_SCHEMA.properties.bookingIntent.enum,
    MODEL_BOOKING_INTENTS,
  );
  assert.deepEqual(
    MODEL_PROPOSAL_JSON_SCHEMA.properties.handoffTrigger.enum,
    MODEL_HANDOFF_TRIGGERS,
  );
  assert.deepEqual(
    MODEL_PROPOSAL_JSON_SCHEMA.properties.replyText.type,
    ["string", "null"],
  );
});

test("returns only a validated proposal and normalized usage", async () => {
  const harness = makeHarness({ response: completedResponse() });

  const result = await requestOpenAiModelProposalWithDependencies(
    PROMPT,
    harness.dependencies,
  );

  assert.deepEqual(result, {
    outcome: "success",
    proposal: VALID_PROPOSAL,
    model: "gpt-5.6-luna",
    usage: {
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 40,
    },
  });
});

test("uses the configured model override in the request and result", async () => {
  const model = resolveOpenAiAiModel("gpt-5.6-sol");
  const harness = makeHarness(
    { response: completedResponse() },
    { model },
  );

  const result = await requestOpenAiModelProposalWithDependencies(
    PROMPT,
    harness.dependencies,
  );

  assert.equal(harness.getRequest()?.model, "gpt-5.6-sol");
  assert.equal(result.outcome === "success" ? result.model : null, model);
});

test("rejects semantic contradictions through Part 1 validation", async () => {
  const harness = makeHarness({
    response: completedResponse({
      ...VALID_PROPOSAL,
      bookingIntent: "create_appointment",
    }),
  });

  assert.deepEqual(
    await requestOpenAiModelProposalWithDependencies(
      PROMPT,
      harness.dependencies,
    ),
    { outcome: "failure", reason: "invalid_model_output" },
  );
});

test("malformed and empty output are invalid_model_output", async () => {
  for (const output_text of ["not-json", "   "]) {
    const harness = makeHarness({
      response: { status: "completed", output_text },
    });
    assert.deepEqual(
      await requestOpenAiModelProposalWithDependencies(
        PROMPT,
        harness.dependencies,
      ),
      { outcome: "failure", reason: "invalid_model_output" },
    );
  }
});

test("requires a completed provider response", async () => {
  const harness = makeHarness({
    response: {
      status: "incomplete",
      output_text: JSON.stringify(VALID_PROPOSAL),
    },
  });

  assert.deepEqual(
    await requestOpenAiModelProposalWithDependencies(
      PROMPT,
      harness.dependencies,
    ),
    { outcome: "failure", reason: "incomplete_response" },
  );
});

test("provider exceptions become a safe provider_error", async () => {
  const sensitiveError = new Error("sk-sensitive-key raw provider body");
  const harness = makeHarness({ error: sensitiveError });

  const result = await requestOpenAiModelProposalWithDependencies(
    PROMPT,
    harness.dependencies,
  );

  assert.deepEqual(result, { outcome: "failure", reason: "provider_error" });
  assert.doesNotMatch(JSON.stringify(result), /sensitive|provider body|sk-/i);
});

test("the injected official timeout abstraction maps to timeout", async () => {
  const timeoutError = new Error("timeout details");
  const harness = makeHarness(
    { error: timeoutError },
    { timeoutError },
  );

  assert.deepEqual(
    await requestOpenAiModelProposalWithDependencies(
      PROMPT,
      harness.dependencies,
    ),
    { outcome: "failure", reason: "timeout" },
  );
});

test("configuration failures are generic and do not invoke a provider", async () => {
  let providerCalled = false;
  const result = await requestOpenAiModelProposalWithDependencies(PROMPT, {
    getModel: () => {
      throw new Error("sk-sensitive-key");
    },
    createClient: () => ({
      responses: {
        create: async () => {
          providerCalled = true;
          return completedResponse();
        },
      },
    }),
    isTimeoutError: () => false,
  });

  assert.deepEqual(result, {
    outcome: "failure",
    reason: "configuration_missing",
  });
  assert.equal(providerCalled, false);
  assert.doesNotMatch(JSON.stringify(result), /sensitive|sk-/i);
});

test("missing or malformed usage becomes null without rejecting proposal", async () => {
  const responses = [
    {
      status: "completed",
      output_text: JSON.stringify(VALID_PROPOSAL),
    },
    completedResponse(VALID_PROPOSAL, {
      input_tokens: -1,
      output_tokens: 2,
      total_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
    }),
    completedResponse(VALID_PROPOSAL, {
      input_tokens: 1,
      output_tokens: Number.NaN,
      total_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
    }),
    completedResponse(VALID_PROPOSAL, {
      input_tokens: 1,
      output_tokens: 2,
      total_tokens: 3,
      input_tokens_details: { cached_tokens: Number.POSITIVE_INFINITY },
    }),
  ];

  for (const response of responses) {
    const harness = makeHarness({ response });
    const result = await requestOpenAiModelProposalWithDependencies(
      PROMPT,
      harness.dependencies,
    );
    assert.equal(result.outcome, "success");
    if (result.outcome === "success") assert.equal(result.usage, null);
  }
});
