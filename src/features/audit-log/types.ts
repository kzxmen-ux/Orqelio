export const AUDIT_EVENT_TYPES = [
  "ai_settings_updated",
  "ai_settings_restored",
  "ai_settings_ready",
  "ai_settings_draft",
  "admin_invited",
  "admin_invitation_accepted",
  "admin_removed",
  "altegio_connection_started",
  "altegio_callback_received",
  "altegio_activation_succeeded",
  "altegio_activation_failed",
  "altegio_access_verification_failed",
  "altegio_disconnected",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditCategory = "ai" | "administrators" | "all" | "integrations";

export type SafeAuditMetadata = {
  errorCode?: string;
  invitationRole?: "admin";
  locationCount?: number;
  newStatus?: "draft" | "ready";
  previousStatus?: "draft" | "ready" | null;
  provider?: "altegio";
  removedRole?: "admin";
  versionNumber?: number;
};

export type OrganizationAuditEvent = {
  actorUserId: string | null;
  createdAt: string;
  eventType: AuditEventType;
  id: string;
  metadata: SafeAuditMetadata;
  organizationId: string;
  targetId: string | null;
  targetType: string | null;
};

export const AUDIT_CATEGORY_EVENT_TYPES: Record<
  Exclude<AuditCategory, "all">,
  AuditEventType[]
> = {
  administrators: [
    "admin_invited",
    "admin_invitation_accepted",
    "admin_removed",
  ],
  ai: [
    "ai_settings_updated",
    "ai_settings_restored",
    "ai_settings_ready",
    "ai_settings_draft",
  ],
  integrations: [
    "altegio_connection_started",
    "altegio_callback_received",
    "altegio_activation_succeeded",
    "altegio_activation_failed",
    "altegio_access_verification_failed",
    "altegio_disconnected",
  ],
};

export function getAuditCategory(eventType: AuditEventType): Exclude<AuditCategory, "all"> {
  if (eventType.startsWith("ai_")) return "ai";
  if (eventType.startsWith("admin_")) return "administrators";
  return "integrations";
}
