import { runAiMessageRunRecoveryWorker } from "@/features/ai-runtime/message-run-recovery-worker";
import { getCronSecret } from "@/lib/env/server";
import { createAiMessageRunRecoveryGetHandler } from "./route-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createAiMessageRunRecoveryGetHandler({
  getCronSecret,
  runRecovery: runAiMessageRunRecoveryWorker,
});
