export type BookingTimeContext = {
  timeZone: string;
};

export type BookingTimeContextResult =
  | {
      success: true;
      context: BookingTimeContext;
    }
  | {
      success: false;
      code: "time_context_unavailable";
    };

export type BookingTimeContextDependencies = {
  loadOrganizationRows(organizationId: string): Promise<unknown>;
  isValidTimeZone(timeZone: string): boolean;
};

type OrganizationTimeZoneRow = {
  id: string;
  timezone: string;
};

function unavailable(): BookingTimeContextResult {
  return { success: false, code: "time_context_unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrganizationRow(value: unknown): OrganizationTimeZoneRow | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.timezone !== "string"
  ) {
    return null;
  }

  return { id: value.id, timezone: value.timezone };
}

export function isIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function loadBookingTimeContextForOrganizationCore(
  organizationId: string,
  dependencies: BookingTimeContextDependencies,
): Promise<BookingTimeContextResult> {
  try {
    const loadedRows = await dependencies.loadOrganizationRows(organizationId);
    if (!Array.isArray(loadedRows) || loadedRows.length !== 1) {
      return unavailable();
    }

    const row = parseOrganizationRow(loadedRows[0]);
    if (row === null || row.id !== organizationId) {
      return unavailable();
    }

    const timeZone = row.timezone.trim();
    if (timeZone.length === 0 || !dependencies.isValidTimeZone(timeZone)) {
      return unavailable();
    }

    return {
      success: true,
      context: { timeZone },
    };
  } catch {
    return unavailable();
  }
}
