export type BookingCustomerContext = {
  phone: string;
  displayName: string | null;
};

export type BookingCustomerContextResult =
  | {
      success: true;
      context: BookingCustomerContext;
    }
  | {
      success: false;
      code: "customer_context_unavailable";
    };

export type BookingCustomerContextDependencies = {
  loadConversationRows(
    organizationId: string,
    conversationId: string,
  ): Promise<unknown>;
};

type ConversationRow = {
  id: string;
  organizationId: string;
  channel: string;
  connectionId: string;
  externalParticipantId: string;
  displayName: string | null;
  connection: {
    id: string;
    organizationId: string;
    status: string;
  };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WHATSAPP_IDENTITY_PATTERN = /^[0-9]{1,32}$/;

function unavailable(): BookingCustomerContextResult {
  return { success: false, code: "customer_context_unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConversationRow(value: unknown): ConversationRow | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.organization_id !== "string" ||
    typeof value.channel !== "string" ||
    typeof value.channel_connection_id !== "string" ||
    typeof value.external_participant_id !== "string" ||
    (value.display_name !== null && typeof value.display_name !== "string") ||
    !isRecord(value.connection) ||
    typeof value.connection.id !== "string" ||
    typeof value.connection.organization_id !== "string" ||
    typeof value.connection.status !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    organizationId: value.organization_id,
    channel: value.channel,
    connectionId: value.channel_connection_id,
    externalParticipantId: value.external_participant_id,
    displayName: value.display_name,
    connection: {
      id: value.connection.id,
      organizationId: value.connection.organization_id,
      status: value.connection.status,
    },
  };
}

export async function loadBookingCustomerContextCore(
  organizationId: string,
  conversationId: string,
  dependencies: BookingCustomerContextDependencies,
): Promise<BookingCustomerContextResult> {
  try {
    if (
      !UUID_PATTERN.test(organizationId) ||
      !UUID_PATTERN.test(conversationId)
    ) {
      return unavailable();
    }

    const loadedRows = await dependencies.loadConversationRows(
      organizationId,
      conversationId,
    );
    if (!Array.isArray(loadedRows) || loadedRows.length !== 1) {
      return unavailable();
    }

    const row = parseConversationRow(loadedRows[0]);
    if (
      row === null ||
      row.id !== conversationId ||
      row.organizationId !== organizationId ||
      row.channel !== "whatsapp" ||
      row.connectionId !== row.connection.id ||
      row.connection.organizationId !== organizationId ||
      row.connection.status !== "active"
    ) {
      return unavailable();
    }

    const phone = row.externalParticipantId.trim();
    if (!WHATSAPP_IDENTITY_PATTERN.test(phone)) {
      return unavailable();
    }

    const normalizedDisplayName = row.displayName?.trim() ?? "";
    return {
      success: true,
      context: {
        phone,
        displayName:
          normalizedDisplayName.length === 0 ? null : normalizedDisplayName,
      },
    };
  } catch {
    return unavailable();
  }
}
