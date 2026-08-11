import "server-only";

import { z } from "zod";

import { listCrmConnections } from "@/features/crm-connections/queries/crm-connections";
import { createClient } from "@/lib/supabase/server";

import { resolveAltegioStatusCenter } from "../status-center";
import type { AltegioIntegrationAttempt, AltegioStatusCenter } from "../types";

const attemptRowsSchema = z.array(
  z.object({
    activated_location_count: z.number().int().nonnegative(),
    activation_failed_count: z.number().int().nonnegative(),
    actor_user_id: z.uuid(),
    attempt_id: z.uuid(),
    attempt_status: z.enum([
      "error",
      "expired",
      "partial",
      "pending",
      "processing",
      "succeeded",
    ]),
    callback_received_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    connection_id: z.uuid().nullable(),
    created_at: z.string(),
    expires_at: z.string(),
    safe_error_code: z.string().max(64).nullable(),
    selected_location_count: z.number().int().nonnegative(),
    updated_at: z.string(),
    verification_failed_count: z.number().int().nonnegative(),
    verified_location_count: z.number().int().nonnegative(),
  }),
);

export type AltegioAttemptsResult = {
  attempts: AltegioIntegrationAttempt[];
  status: "error" | "success";
};

export async function listAltegioIntegrationAttempts(
  organizationId: string,
): Promise<AltegioAttemptsResult> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (!authData.user || authError) {
    return { attempts: [], status: "error" };
  }

  const { data, error } = await supabase.rpc(
    "list_altegio_integration_attempts",
    { p_limit: 10, p_organization_id: organizationId },
  );
  const parsed = attemptRowsSchema.safeParse(data);
  if (error || !parsed.success) {
    return { attempts: [], status: "error" };
  }

  const now = Date.now();
  return {
    attempts: parsed.data.map((row) => ({
      activatedLocationCount: row.activated_location_count,
      activationFailedCount: row.activation_failed_count,
      actorUserId: row.actor_user_id,
      attemptId: row.attempt_id,
      callbackReceivedAt: row.callback_received_at,
      canRetry:
        (row.attempt_status === "error" || row.attempt_status === "partial") &&
        new Date(row.expires_at).getTime() > now,
      completedAt: row.completed_at,
      connectionId: row.connection_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      safeErrorCode: row.safe_error_code,
      selectedLocationCount: row.selected_location_count,
      status: row.attempt_status,
      updatedAt: row.updated_at,
      verificationFailedCount: row.verification_failed_count,
      verifiedLocationCount: row.verified_location_count,
    })),
    status: "success",
  };
}

export async function getAltegioStatusCenter(
  organizationId: string,
): Promise<{ center: AltegioStatusCenter; status: "error" | "success" }> {
  const [connections, attemptResult] = await Promise.all([
    listCrmConnections(organizationId),
    listAltegioIntegrationAttempts(organizationId),
  ]);
  return {
    center: resolveAltegioStatusCenter({
      attempts: attemptResult.attempts,
      connections,
    }),
    status: attemptResult.status,
  };
}
