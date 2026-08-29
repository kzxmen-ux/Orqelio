import { validateModelProposal } from "./decision-core.ts";
import {
  MAX_MODEL_BOOKING_REQUEST_FIELD_CHARACTERS,
  MODEL_BOOKING_INTENTS,
  MODEL_BOOKING_REQUEST_FIELDS,
  MODEL_HANDOFF_TRIGGERS,
  MODEL_RESPONSE_INTENTS,
  type ModelProposal,
} from "./decision-types.ts";
import type { AiDecisionPrompt } from "./prompt-builder.ts";

export const OPENAI_DECISION_MAX_OUTPUT_TOKENS = 1_200;
export const OPENAI_DECISION_REQUEST_TIMEOUT_MS = 15_000;
export const OPENAI_DECISION_MAX_RETRIES = 0;

const MODEL_PROPOSAL_FIELDS = [
  "responseIntent",
  "replyText",
  "bookingIntent",
  "bookingRequest",
  "handoffTrigger",
] as const;

const BOOKING_REQUEST_VALUE_JSON_SCHEMA = {
  type: ["string", "null"],
  maxLength: MAX_MODEL_BOOKING_REQUEST_FIELD_CHARACTERS,
} as const;

export const MODEL_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    responseIntent: {
      type: "string",
      enum: [...MODEL_RESPONSE_INTENTS],
    },
    replyText: {
      type: ["string", "null"],
    },
    bookingIntent: {
      type: "string",
      enum: [...MODEL_BOOKING_INTENTS],
    },
    bookingRequest: {
      type: ["object", "null"],
      properties: {
        serviceQuery: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        staffQuery: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        dateText: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        timeText: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        customerName: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        customerPhone: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
        appointmentReference: BOOKING_REQUEST_VALUE_JSON_SCHEMA,
      },
      required: [...MODEL_BOOKING_REQUEST_FIELDS],
      additionalProperties: false,
    },
    handoffTrigger: {
      type: "string",
      enum: [...MODEL_HANDOFF_TRIGGERS],
    },
  },
  required: [...MODEL_PROPOSAL_FIELDS],
  additionalProperties: false,
} as const;

export type OpenAiDecisionRequest = {
  model: string;
  instructions: string;
  input: AiDecisionPrompt["input"];
  store: false;
  reasoning: { effort: "low" };
  max_output_tokens: typeof OPENAI_DECISION_MAX_OUTPUT_TOKENS;
  text: {
    format: {
      type: "json_schema";
      name: "orqelio_ai_model_proposal";
      strict: true;
      schema: typeof MODEL_PROPOSAL_JSON_SCHEMA;
    };
  };
};

export type OpenAiResponsesClient = {
  responses: {
    create: (request: OpenAiDecisionRequest) => Promise<unknown>;
  };
};

export type OpenAiTransportUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
};

export type OpenAiTransportResult =
  | {
      outcome: "success";
      proposal: ModelProposal;
      model: string;
      usage: OpenAiTransportUsage | null;
    }
  | {
      outcome: "failure";
      reason:
        | "configuration_missing"
        | "provider_error"
        | "timeout"
        | "incomplete_response"
        | "invalid_model_output";
    };

export type OpenAiTransportDependencies = {
  createClient: () => OpenAiResponsesClient;
  getModel: () => string;
  isTimeoutError: (error: unknown) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeUsage(value: unknown): OpenAiTransportUsage | null {
  if (!isRecord(value) || !isRecord(value.input_tokens_details)) return null;

  const inputTokens = value.input_tokens;
  const outputTokens = value.output_tokens;
  const totalTokens = value.total_tokens;
  const cachedInputTokens = value.input_tokens_details.cached_tokens;

  if (
    !isSafeTokenCount(inputTokens) ||
    !isSafeTokenCount(outputTokens) ||
    !isSafeTokenCount(totalTokens) ||
    !isSafeTokenCount(cachedInputTokens)
  ) {
    return null;
  }

  return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
}

export function buildOpenAiDecisionRequest(
  prompt: AiDecisionPrompt,
  model: string,
): OpenAiDecisionRequest {
  return {
    model,
    instructions: prompt.instructions,
    input: prompt.input,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: OPENAI_DECISION_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "orqelio_ai_model_proposal",
        strict: true,
        schema: MODEL_PROPOSAL_JSON_SCHEMA,
      },
    },
  };
}

export async function requestOpenAiModelProposalWithDependencies(
  prompt: AiDecisionPrompt,
  dependencies: OpenAiTransportDependencies,
): Promise<OpenAiTransportResult> {
  let client: OpenAiResponsesClient;
  let model: string;

  try {
    model = dependencies.getModel();
    client = dependencies.createClient();
  } catch {
    return { outcome: "failure", reason: "configuration_missing" };
  }

  let response: unknown;
  try {
    response = await client.responses.create(
      buildOpenAiDecisionRequest(prompt, model),
    );
  } catch (error) {
    return {
      outcome: "failure",
      reason: dependencies.isTimeoutError(error) ? "timeout" : "provider_error",
    };
  }

  if (!isRecord(response) || response.status !== "completed") {
    return { outcome: "failure", reason: "incomplete_response" };
  }

  if (
    typeof response.output_text !== "string" ||
    response.output_text.trim().length === 0
  ) {
    return { outcome: "failure", reason: "invalid_model_output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text.trim());
  } catch {
    return { outcome: "failure", reason: "invalid_model_output" };
  }

  const validation = validateModelProposal(parsed);
  if (!validation.valid) {
    return { outcome: "failure", reason: "invalid_model_output" };
  }

  return {
    outcome: "success",
    proposal: validation.proposal,
    model,
    usage: normalizeUsage(response.usage),
  };
}
