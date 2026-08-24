import "server-only";

import type { ConversationAiContext } from "./conversation-context-core.ts";
import { createOpenAiResponsesClient, isOpenAiTimeoutError } from "./openai-client.ts";
import {
  requestOpenAiModelProposalWithDependencies,
  type OpenAiTransportResult,
} from "./openai-transport-core.ts";
import { buildAiDecisionPrompt } from "./prompt-builder.ts";
import { getOpenAiAiModel } from "../../lib/env/server.ts";

export async function requestOpenAiModelProposal(
  context: ConversationAiContext,
): Promise<OpenAiTransportResult> {
  return requestOpenAiModelProposalWithDependencies(
    buildAiDecisionPrompt(context),
    {
      createClient: createOpenAiResponsesClient,
      getModel: getOpenAiAiModel,
      isTimeoutError: isOpenAiTimeoutError,
    },
  );
}
