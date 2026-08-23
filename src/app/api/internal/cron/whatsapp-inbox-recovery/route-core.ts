import { createHash, timingSafeEqual } from "node:crypto";

import type { WhatsappInboxRecoveryResult } from "@/features/messaging/whatsapp/inbox-recovery-core";

export type WhatsappInboxRecoveryRouteDependencies = {
  getCronSecret: () => string;
  recoverInbox: () => Promise<WhatsappInboxRecoveryResult>;
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

export function createWhatsappInboxRecoveryGetHandler(
  dependencies: WhatsappInboxRecoveryRouteDependencies,
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
      const result = await dependencies.recoverInbox();
      return jsonResponse(result, 200);
    } catch {
      return jsonResponse({ error: "internal_error" }, 500);
    }
  };
}
