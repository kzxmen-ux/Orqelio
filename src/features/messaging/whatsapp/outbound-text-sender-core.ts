const META_GRAPH_API_VERSION = "v26.0";
const META_REQUEST_TIMEOUT_MS = 15_000;
const META_IDENTIFIER_PATTERN = /^[0-9]+$/;

export type WhatsappTextMessageInput = {
  phoneNumberId: string;
  recipientWaId: string;
  text: string;
};

export type WhatsappTextMessageResult = {
  providerMessageId: string;
};

export type WhatsappOutboundFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type WhatsappTextSenderDependencies = {
  createTimeoutSignal: (timeoutMs: number) => AbortSignal;
  fetch: WhatsappOutboundFetch;
  getAccessToken: () => string;
};

function invalidInput(): Error {
  return new Error("Invalid WhatsApp outbound message.");
}

function outboundFailure(): Error {
  return new Error("WhatsApp outbound message failed.");
}

function isDecimalIdentifier(value: unknown): value is string {
  return typeof value === "string" && META_IDENTIFIER_PATTERN.test(value);
}

function validateInput(input: unknown): WhatsappTextMessageInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("phoneNumberId" in input) ||
    !isDecimalIdentifier(input.phoneNumberId) ||
    !("recipientWaId" in input) ||
    !isDecimalIdentifier(input.recipientWaId) ||
    !("text" in input) ||
    typeof input.text !== "string" ||
    input.text.trim().length === 0
  ) {
    throw invalidInput();
  }

  return {
    phoneNumberId: input.phoneNumberId,
    recipientWaId: input.recipientWaId,
    text: input.text,
  };
}

function parseProviderMessageId(data: unknown): string | null {
  if (
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    !("messages" in data) ||
    !Array.isArray(data.messages) ||
    data.messages.length !== 1
  ) {
    return null;
  }

  const message = data.messages[0];

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    !("id" in message) ||
    typeof message.id !== "string" ||
    message.id.trim().length === 0 ||
    message.id !== message.id.trim()
  ) {
    return null;
  }

  return message.id;
}

export async function sendWhatsappTextMessageWithDependencies(
  input: unknown,
  dependencies: WhatsappTextSenderDependencies,
): Promise<WhatsappTextMessageResult> {
  const validatedInput = validateInput(input);

  let accessToken: string;

  try {
    accessToken = dependencies.getAccessToken();
  } catch {
    throw outboundFailure();
  }

  if (
    typeof accessToken !== "string" ||
    accessToken.trim().length === 0 ||
    accessToken !== accessToken.trim()
  ) {
    throw outboundFailure();
  }

  let response: Response;

  try {
    const signal = dependencies.createTimeoutSignal(META_REQUEST_TIMEOUT_MS);

    response = await dependencies.fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${validatedInput.phoneNumberId}/messages`,
      {
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          text: { body: validatedInput.text },
          to: validatedInput.recipientWaId,
          type: "text",
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
  } catch {
    throw outboundFailure();
  }

  if (!response.ok) {
    throw outboundFailure();
  }

  let responseData: unknown;

  try {
    responseData = (await response.json()) as unknown;
  } catch {
    throw outboundFailure();
  }

  const providerMessageId = parseProviderMessageId(responseData);

  if (!providerMessageId) {
    throw outboundFailure();
  }

  return { providerMessageId };
}
