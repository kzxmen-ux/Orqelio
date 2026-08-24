import "server-only";

import OpenAI, { APIConnectionTimeoutError } from "openai";

import { getOpenAiApiKey } from "../../lib/env/server.ts";
import {
  OPENAI_DECISION_MAX_RETRIES,
  OPENAI_DECISION_REQUEST_TIMEOUT_MS,
  type OpenAiDecisionRequest,
  type OpenAiResponsesClient,
} from "./openai-transport-core.ts";

export function createOpenAiResponsesClient(): OpenAiResponsesClient {
  const client = new OpenAI({
    apiKey: getOpenAiApiKey(),
    maxRetries: OPENAI_DECISION_MAX_RETRIES,
    timeout: OPENAI_DECISION_REQUEST_TIMEOUT_MS,
  });

  return {
    responses: {
      create: (request: OpenAiDecisionRequest) =>
        client.responses.create(request),
    },
  };
}

export function isOpenAiTimeoutError(error: unknown): boolean {
  return error instanceof APIConnectionTimeoutError;
}
