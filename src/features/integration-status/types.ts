import type { CrmConnection } from "@/features/crm-connections/types";

export type AltegioAttemptStatus =
  | "error"
  | "expired"
  | "partial"
  | "pending"
  | "processing"
  | "succeeded";

export type AltegioIntegrationAttempt = {
  activatedLocationCount: number;
  activationFailedCount: number;
  actorUserId: string;
  attemptId: string;
  callbackReceivedAt: string | null;
  canRetry: boolean;
  completedAt: string | null;
  connectionId: string | null;
  createdAt: string;
  expiresAt: string;
  safeErrorCode: string | null;
  selectedLocationCount: number;
  status: AltegioAttemptStatus;
  updatedAt: string;
  verificationFailedCount: number;
  verifiedLocationCount: number;
};

export type IntegrationCenterStatus =
  | "activation"
  | "awaiting_return"
  | "connected"
  | "disconnected"
  | "error"
  | "not_connected"
  | "partial"
  | "paused"
  | "started"
  | "verification";

export type IntegrationErrorCategory =
  | "authorization_rejected"
  | "expired"
  | "insufficient_permissions"
  | "partial_activation"
  | "provider_unavailable"
  | "unknown_provider_error"
  | "verification_failed";

export type ProgressStepState = "completed" | "current" | "failed" | "pending";

export type IntegrationProgressStep = {
  key: "activated" | "callback" | "completed" | "started" | "verified";
  state: ProgressStepState;
};

export type AltegioStatusCenter = {
  attempts: AltegioIntegrationAttempt[];
  connection: CrmConnection | null;
  errorCategory: IntegrationErrorCategory | null;
  latestAttempt: AltegioIntegrationAttempt | null;
  lastMeaningfulAt: string | null;
  progress: IntegrationProgressStep[];
  status: IntegrationCenterStatus;
};
