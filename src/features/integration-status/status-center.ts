import type { CrmConnection } from "@/features/crm-connections/types";

import type {
  AltegioIntegrationAttempt,
  AltegioStatusCenter,
  IntegrationCenterStatus,
  IntegrationErrorCategory,
  IntegrationProgressStep,
} from "./types";

export function getAttemptErrorCategory(
  attempt: AltegioIntegrationAttempt | null,
  now: Date = new Date(),
): IntegrationErrorCategory | null {
  if (!attempt) return null;
  if (attempt.status === "expired" || new Date(attempt.expiresAt).getTime() <= now.getTime() && attempt.status === "pending") return "expired";
  if (attempt.status === "partial") return "partial_activation";
  if (attempt.verificationFailedCount > 0) return "verification_failed";
  if (attempt.safeErrorCode === "unauthorized") return "authorization_rejected";
  if (attempt.safeErrorCode === "forbidden") return "insufficient_permissions";
  if (attempt.safeErrorCode === "provider_unavailable" || attempt.safeErrorCode === "timeout") return "provider_unavailable";
  return attempt.status === "error" || attempt.activationFailedCount > 0
    ? "unknown_provider_error"
    : null;
}

function attemptStatus(attempt: AltegioIntegrationAttempt, now: Date): IntegrationCenterStatus {
  if (attempt.status === "pending" && new Date(attempt.expiresAt).getTime() <= now.getTime()) return "error";
  if (attempt.status === "succeeded") return "connected";
  if (attempt.status === "partial") return "partial";
  if (attempt.status === "error" || attempt.status === "expired") return "error";
  if (!attempt.callbackReceivedAt) return "awaiting_return";
  if (attempt.activatedLocationCount < attempt.selectedLocationCount) return "activation";
  if (attempt.verifiedLocationCount < attempt.selectedLocationCount) return "verification";
  return "started";
}

function selectConnection(connections: CrmConnection[]): CrmConnection | null {
  return [...connections]
    .filter((connection) => connection.provider === "altegio")
    .sort((a, b) => {
      const priority = { connected: 3, error: 2, draft: 1, disconnected: 0 };
      return priority[b.status] - priority[a.status] || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0] ?? null;
}

function progress(
  status: IntegrationCenterStatus,
  attempt: AltegioIntegrationAttempt | null,
  connection: CrmConnection | null,
): IntegrationProgressStep[] {
  const selected = attempt?.selectedLocationCount ?? connection?.configuration.locationIds?.length ?? 0;
  const activated = attempt?.activatedLocationCount ?? connection?.configuration.activatedLocationIds?.length ?? 0;
  const verified = attempt?.verifiedLocationCount ?? connection?.configuration.verifiedLocationIds?.length ?? 0;
  const hasAttempt = Boolean(attempt || connection);
  const callback = selected > 0;
  const activationFailed = (attempt?.activationFailedCount ?? 0) > 0;
  const verificationFailed = (attempt?.verificationFailedCount ?? 0) > 0;
  const terminalFailure = status === "error" || status === "partial" || status === "disconnected";

  return [
    { key: "started", state: hasAttempt ? "completed" : "current" },
    { key: "callback", state: callback ? "completed" : hasAttempt ? status === "error" ? "failed" : "current" : "pending" },
    { key: "activated", state: selected > 0 && activated >= selected ? "completed" : activationFailed ? "failed" : callback ? "current" : "pending" },
    { key: "verified", state: selected > 0 && verified >= selected ? "completed" : verificationFailed ? "failed" : activated > 0 ? "current" : "pending" },
    { key: "completed", state: status === "connected" ? "completed" : terminalFailure ? "failed" : "pending" },
  ];
}

export function resolveAltegioStatusCenter(input: {
  attempts: AltegioIntegrationAttempt[];
  connections: CrmConnection[];
  now?: Date;
}): AltegioStatusCenter {
  const now = input.now ?? new Date();
  const connection = selectConnection(input.connections);
  const latestAttempt = input.attempts[0] ?? null;
  let status: IntegrationCenterStatus;

  if (connection?.status === "connected") status = "connected";
  else if (latestAttempt) status = attemptStatus(latestAttempt, now);
  else if (connection?.status === "disconnected") status = "disconnected";
  else if (connection?.status === "error" && connection.configuration.providerActivationStatus === "partial") status = "partial";
  else if (connection?.status === "error") status = "error";
  else if (connection?.status === "draft") status = "started";
  else status = "not_connected";

  const lastMeaningfulAt = [connection?.updatedAt, latestAttempt?.updatedAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

  return {
    attempts: input.attempts,
    connection,
    errorCategory: status === "error" || status === "partial"
      ? getAttemptErrorCategory(latestAttempt, now)
      : null,
    latestAttempt,
    lastMeaningfulAt,
    progress: progress(status, latestAttempt, connection),
    status,
  };
}
