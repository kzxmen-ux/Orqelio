const MAX_PROVIDER_IDENTIFIER_LENGTH = 32;
const PROVIDER_IDENTIFIER_PATTERN = /^[0-9]+$/;

export type WhatsappConnectionInput = {
  wabaId: string;
  phoneNumberId: string;
};

export type ResolvedWhatsappConnection = {
  connectionId: string;
  organizationId: string;
};

export type WhatsappConnectionQueryResult = {
  data: unknown;
  error: unknown;
};

export type WhatsappConnectionQuery = (
  input: WhatsappConnectionInput,
) => Promise<WhatsappConnectionQueryResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidWhatsappProviderIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_PROVIDER_IDENTIFIER_LENGTH &&
    PROVIDER_IDENTIFIER_PATTERN.test(value)
  );
}

export function validateWhatsappConnectionInput(
  input: WhatsappConnectionInput,
): WhatsappConnectionInput | null {
  if (
    !isValidWhatsappProviderIdentifier(input.wabaId) ||
    !isValidWhatsappProviderIdentifier(input.phoneNumberId)
  ) {
    return null;
  }

  return input;
}

export async function resolveWhatsappConnectionWithQuery(
  input: WhatsappConnectionInput,
  query: WhatsappConnectionQuery,
): Promise<ResolvedWhatsappConnection | null> {
  const validatedInput = validateWhatsappConnectionInput(input);

  if (!validatedInput) {
    return null;
  }

  const result = await query(validatedInput);

  if (result.error) {
    throw new Error("WhatsApp connection resolution failed.");
  }

  if (!Array.isArray(result.data)) {
    throw new Error("WhatsApp connection resolution failed.");
  }

  if (result.data.length === 0) {
    return null;
  }

  if (result.data.length !== 1) {
    throw new Error("WhatsApp connection resolution is ambiguous.");
  }

  const row = result.data[0];

  if (!isRecord(row)) {
    throw new Error("WhatsApp connection resolution failed.");
  }

  if (row.status !== "active") {
    return null;
  }

  if (
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    typeof row.organization_id !== "string" ||
    row.organization_id.length === 0
  ) {
    throw new Error("WhatsApp connection resolution failed.");
  }

  return {
    connectionId: row.id,
    organizationId: row.organization_id,
  };
}
