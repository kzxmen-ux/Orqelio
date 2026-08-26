import "server-only";

import { runAiRuntime } from "./runtime.ts";
import {
  processAiInboundMessageWithDependencies,
  type AiInboundProcessingInput,
  type AiInboundProcessingResult,
} from "./inbound-processing-core.ts";

export function processAiInboundMessage(
  input: AiInboundProcessingInput,
): Promise<AiInboundProcessingResult> {
  return processAiInboundMessageWithDependencies(input, {
    runRuntime: runAiRuntime,
  });
}
