import { timingSafeEqual } from "node:crypto";

export type WhatsappVerificationDependencies = {
  getVerificationToken(): string;
};

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=utf-8",
} as const;

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    headers: RESPONSE_HEADERS,
    status,
  });
}

function hasSingleValue(searchParams: URLSearchParams, name: string): boolean {
  return searchParams.getAll(name).length === 1;
}

function tokensMatch(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");

  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export function handleWhatsappWebhookVerification(
  request: Request,
  dependencies: WhatsappVerificationDependencies,
): Response {
  const searchParams = new URL(request.url).searchParams;
  const mode = searchParams.get("hub.mode");
  const receivedToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    receivedToken === null ||
    challenge === null ||
    challenge.length === 0 ||
    !hasSingleValue(searchParams, "hub.mode") ||
    !hasSingleValue(searchParams, "hub.verify_token") ||
    !hasSingleValue(searchParams, "hub.challenge")
  ) {
    return textResponse("Forbidden", 403);
  }

  let expectedToken: string;

  try {
    expectedToken = dependencies.getVerificationToken();
  } catch {
    return textResponse("Service unavailable", 503);
  }

  if (!expectedToken || !tokensMatch(receivedToken, expectedToken)) {
    return textResponse("Forbidden", 403);
  }

  return textResponse(challenge, 200);
}
