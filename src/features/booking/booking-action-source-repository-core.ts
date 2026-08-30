import {
  sanitizeDurableBookingDecision,
  type DurableBookingDecisionSource,
} from "../ai-runtime/message-run-repository-core.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BookingActionSource = DurableBookingDecisionSource & {
  conversationId: string;
};

export type BookingActionSourceResult =
  | { success: true; source: BookingActionSource }
  | { success: false; code: "booking_source_unavailable" };

export type BookingActionSourceRepositoryDependencies = {
  loadRows(
    organizationId: string,
    aiMessageRunId: string,
  ): Promise<unknown>;
};

function unavailable(): BookingActionSourceResult {
  return { success: false, code: "booking_source_unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function loadBookingActionSourceCore(
  organizationId: string,
  aiMessageRunId: string,
  dependencies: BookingActionSourceRepositoryDependencies,
): Promise<BookingActionSourceResult> {
  try {
    if (
      !UUID_PATTERN.test(organizationId) ||
      !UUID_PATTERN.test(aiMessageRunId)
    ) {
      return unavailable();
    }

    const rows = await dependencies.loadRows(organizationId, aiMessageRunId);
    if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
      return unavailable();
    }

    const row = rows[0];
    if (
      row.id !== aiMessageRunId ||
      row.organization_id !== organizationId ||
      row.status !== "decided" ||
      typeof row.conversation_id !== "string" ||
      !UUID_PATTERN.test(row.conversation_id)
    ) {
      return unavailable();
    }

    const decision = sanitizeDurableBookingDecision(row.decision);
    if (decision === null) return unavailable();

    return {
      success: true,
      source: {
        conversationId: row.conversation_id,
        ...decision,
      },
    };
  } catch {
    return unavailable();
  }
}
