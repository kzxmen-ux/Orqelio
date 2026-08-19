import "server-only";

const ENCRYPTION_KEY_BYTES = 32;

export function getSupabaseSecretKey(): string {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!secretKey?.startsWith("sb_secret_")) {
    throw new Error("Server-only Supabase access is not configured.");
  }

  return secretKey;
}

export function getYclientsCredentialsEncryptionKey(): Buffer {
  const encodedKey = process.env.YCLIENTS_CREDENTIALS_ENCRYPTION_KEY;

  if (!encodedKey) {
    throw new Error("YCLIENTS credential encryption is not configured.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (
    key.length !== ENCRYPTION_KEY_BYTES ||
    key.toString("base64") !== encodedKey
  ) {
    throw new Error("YCLIENTS credential encryption is not configured.");
  }

  return key;
}

export type AltegioServerEnvironment = {
  applicationId: number;
  partnerToken: string;
  userToken: string;
};

export function getAltegioServerEnvironment(): AltegioServerEnvironment {
  const partnerToken = process.env.ALTEGIO_PARTNER_TOKEN?.trim();
  const userToken = process.env.ALTEGIO_USER_TOKEN?.trim();
  const applicationId = Number.parseInt(
    process.env.ALTEGIO_APPLICATION_ID?.trim() ?? "",
    10,
  );

  if (
    !partnerToken ||
    !userToken ||
    applicationId !== 2167 ||
    process.env.ALTEGIO_APPLICATION_ID?.trim() !== "2167"
  ) {
    throw new Error("Altegio Marketplace access is not configured.");
  }

  return { applicationId, partnerToken, userToken };
}

function getRequiredServerSecret(
  name: string,
  value: string | undefined,
): string {
  const secret = value?.trim();

  if (!secret) {
    throw new Error(`${name} is not configured.`);
  }

  return secret;
}

export function getWhatsappWebhookVerifyToken(): string {
  return getRequiredServerSecret(
    "WhatsApp webhook verification",
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  );
}

export function getMetaAppSecret(): string {
  return getRequiredServerSecret(
    "Meta application secret",
    process.env.META_APP_SECRET,
  );
}
