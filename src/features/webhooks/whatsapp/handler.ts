const MAX_RAW_BODY_BYTES = 256 * 1024;

interface WhatsappWebhookStoreResult {
  eventId: string;
  outcome: "accepted" | "duplicate";
}

interface WhatsappWebhookHandlerDependencies {
  storeEvent: (
    payload: Record<string, unknown>,
  ) => Promise<WhatsappWebhookStoreResult>;
  verifySignature: (
    rawBody: Uint8Array,
    signatureHeader: string | null,
  ) => boolean;
}

type RawBodyReadResult =
  | { outcome: "ok"; bytes: Uint8Array }
  | { outcome: "too_large" };

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

async function readRawBody(request: Request): Promise<RawBodyReadResult> {
  if (!request.body) {
    return { bytes: new Uint8Array(), outcome: "ok" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAX_RAW_BODY_BYTES) {
      await reader.cancel();
      return { outcome: "too_large" };
    }

    chunks.push(value);
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes: rawBody, outcome: "ok" };
}

function isWhatsappEnvelope(
  payload: unknown,
): payload is Record<string, unknown> {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    "object" in payload &&
    payload.object === "whatsapp_business_account" &&
    "entry" in payload &&
    Array.isArray(payload.entry)
  );
}

export async function handleWhatsappWebhook(
  request: Request,
  dependencies: WhatsappWebhookHandlerDependencies,
): Promise<Response> {
  let rawBodyResult: RawBodyReadResult;

  try {
    rawBodyResult = await readRawBody(request);
  } catch {
    return jsonResponse({ error: "invalid_body", ok: false }, 400);
  }

  if (rawBodyResult.outcome === "too_large") {
    return jsonResponse({ error: "payload_too_large", ok: false }, 413);
  }

  const signatureHeader = request.headers.get("x-hub-signature-256");
  let signatureIsValid = false;

  try {
    signatureIsValid = dependencies.verifySignature(
      rawBodyResult.bytes,
      signatureHeader,
    );
  } catch {
    signatureIsValid = false;
  }

  if (!signatureIsValid) {
    return jsonResponse({ error: "invalid_signature", ok: false }, 401);
  }

  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();

  if (mediaType !== "application/json") {
    return jsonResponse({ error: "unsupported_media_type", ok: false }, 415);
  }

  let payload: unknown;

  try {
    const rawJson = new TextDecoder("utf-8", { fatal: true }).decode(
      rawBodyResult.bytes,
    );
    payload = JSON.parse(rawJson) as unknown;
  } catch {
    return jsonResponse({ error: "invalid_json", ok: false }, 400);
  }

  if (!isWhatsappEnvelope(payload)) {
    return jsonResponse({ error: "invalid_envelope", ok: false }, 400);
  }

  try {
    const result = await dependencies.storeEvent(payload);

    return jsonResponse(
      { duplicate: result.outcome === "duplicate", ok: true },
      200,
    );
  } catch {
    return jsonResponse({ error: "temporarily_unavailable", ok: false }, 503);
  }
}
