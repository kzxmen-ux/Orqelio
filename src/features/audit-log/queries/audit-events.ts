import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import {
  AUDIT_CATEGORY_EVENT_TYPES,
  AUDIT_EVENT_TYPES,
  type AuditCategory,
  type OrganizationAuditEvent,
} from "../types";

export const AUDIT_PAGE_SIZE = 30;

const rowSchema = z.object({
  actor_user_id: z.uuid().nullable(),
  created_at: z.string(),
  event_type: z.enum(AUDIT_EVENT_TYPES),
  id: z.union([z.number().int().positive(), z.string()]),
  organization_id: z.uuid(),
  safe_metadata: z.object({
    error_code: z.string().max(64).optional(),
    invitation_role: z.literal("admin").optional(),
    location_count: z.number().int().nonnegative().optional(),
    new_status: z.enum(["draft", "ready"]).optional(),
    previous_status: z.enum(["draft", "ready"]).nullable().optional(),
    provider: z.literal("altegio").optional(),
    removed_role: z.literal("admin").optional(),
    version_number: z.number().int().positive().optional(),
  }),
  target_id: z.uuid().nullable(),
  target_type: z.string().nullable(),
});

export type AuditEventsPage = {
  events: OrganizationAuditEvent[];
  hasMore: boolean;
  status: "error" | "success";
};

export async function listOrganizationAuditEvents(input: {
  category: AuditCategory;
  organizationId: string;
  page: number;
}): Promise<AuditEventsPage> {
  const supabase = await createClient();
  const from = input.page * AUDIT_PAGE_SIZE;
  let query = supabase
    .from("organization_audit_events")
    .select(
      "id, organization_id, actor_user_id, event_type, target_type, target_id, safe_metadata, created_at",
    )
    .eq("organization_id", input.organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE);

  if (input.category !== "all") {
    query = query.in("event_type", AUDIT_CATEGORY_EVENT_TYPES[input.category]);
  }

  const { data, error } = await query;
  const parsed = z.array(rowSchema).safeParse(data);
  if (error || !parsed.success) {
    return { events: [], hasMore: false, status: "error" };
  }

  return {
    events: parsed.data.slice(0, AUDIT_PAGE_SIZE).map((row) => ({
      actorUserId: row.actor_user_id,
      createdAt: row.created_at,
      eventType: row.event_type,
      id: String(row.id),
      metadata: {
        errorCode: row.safe_metadata.error_code,
        invitationRole: row.safe_metadata.invitation_role,
        locationCount: row.safe_metadata.location_count,
        newStatus: row.safe_metadata.new_status,
        previousStatus: row.safe_metadata.previous_status,
        provider: row.safe_metadata.provider,
        removedRole: row.safe_metadata.removed_role,
        versionNumber: row.safe_metadata.version_number,
      },
      organizationId: row.organization_id,
      targetId: row.target_id,
      targetType: row.target_type,
    })),
    hasMore: parsed.data.length > AUDIT_PAGE_SIZE,
    status: "success",
  };
}
