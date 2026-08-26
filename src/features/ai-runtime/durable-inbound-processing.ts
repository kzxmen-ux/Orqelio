import "server-only";

import { processAiInboundMessage } from "./inbound-processing.ts";
import {
  processDurableAiInboundMessageWithDependencies,
  type DurableAiInboundProcessingResult,
} from "./durable-inbound-processing-core.ts";
import type { AiInboundProcessingInput } from "./inbound-processing-core.ts";
import {
  claimAiMessageRun,
  storeAiMessageRunTerminalResult,
} from "./message-run-repository.ts";

export function processDurableAiInboundMessage(
  input: AiInboundProcessingInput,
): Promise<DurableAiInboundProcessingResult> {
  return processDurableAiInboundMessageWithDependencies(input, {
    claimRun: claimAiMessageRun,
    processAi: processAiInboundMessage,
    storeTerminalResult: storeAiMessageRunTerminalResult,
  });
}
