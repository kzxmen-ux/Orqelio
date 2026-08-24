import "server-only";

import {
  loadConversationAiContext,
} from "./conversation-context.ts";
import type { ConversationAiContextInput } from "./conversation-context-core.ts";
import { requestOpenAiModelProposal } from "./openai-transport.ts";
import {
  runAiRuntimeWithDependencies,
  type AiRuntimeResult,
} from "./runtime-core.ts";

export function runAiRuntime(
  input: ConversationAiContextInput,
): Promise<AiRuntimeResult> {
  return runAiRuntimeWithDependencies(input, {
    loadContext: loadConversationAiContext,
    requestModelProposal: requestOpenAiModelProposal,
  });
}
