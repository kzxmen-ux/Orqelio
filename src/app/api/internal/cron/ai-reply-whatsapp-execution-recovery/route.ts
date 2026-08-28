import { runAiReplyWhatsappExecutionWorker } from "@/features/messaging/whatsapp/ai-reply-whatsapp-execution-worker";
import { getCronSecret } from "@/lib/env/server";
import { createAiReplyWhatsappExecutionRecoveryGetHandler } from "./route-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createAiReplyWhatsappExecutionRecoveryGetHandler({
  getCronSecret,
  runRecovery: runAiReplyWhatsappExecutionWorker,
});
