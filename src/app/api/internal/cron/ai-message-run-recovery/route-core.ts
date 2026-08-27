import { createHash, timingSafeEqual } from "node:crypto";

import type { AiMessageRunRecoveryWorkerResult } from "@/features/ai-runtime/message-run-recovery-worker-core";

export type AiMessageRunRecoveryRouteDependencies = {
  getCronSecret: () => string;
  runRecovery: (limit: number) => Promise<AiMessageRunRecoveryWorkerResult>;
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function constantTimeAuthorizationMatches(
  authorizationHeader: string | null,
  secret: string,
): boolean {
  const receivedDigest = createHash("sha256")
    .update(authorizationHeader ?? "")
    .digest();
  const expectedDigest = createHash("sha256")
    .update(`Bearer ${secret}`)
    .digest();

  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function createAiMessageRunRecoveryGetHandler(
  dependencies: AiMessageRunRecoveryRouteDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let cronSecret: string;

    try {
      cronSecret = dependencies.getCronSecret();
    } catch {
      return jsonResponse({ error: "service_unavailable" }, 503);
    }

    if (
      !constantTimeAuthorizationMatches(
        request.headers.get("authorization"),
        cronSecret,
      )
    ) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    try {
      const result = await dependencies.runRecovery(1);

      return jsonResponse(
        {
          recoveredRetryableCount: result.recoveredRetryableCount,
          exhaustedCount: result.exhaustedCount,
          pendingCandidateCount: result.pendingCandidateCount,
          completedCount: result.completedCount,
          alreadyProcessingCount: result.alreadyProcessingCount,
          alreadyTerminalCount: result.alreadyTerminalCount,
          failedCount: result.failedCount,
        },
        200,
      );
    } catch {
      return jsonResponse({ error: "internal_error" }, 500);
    }
  };
}
