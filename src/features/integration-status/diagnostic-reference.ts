import { createHash } from "node:crypto";

export function createIntegrationDiagnosticReference(attemptId: string): string {
  const digest = createHash("sha256")
    .update(`orqelio-integration-attempt:${attemptId}`, "utf8")
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return `INT-${digest}`;
}
