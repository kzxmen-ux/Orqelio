import assert from "node:assert/strict";
import test from "node:test";

import {
  createWhatsappInboxRepository,
  type WhatsappInboxRpc,
} from "./inbox-repository-core.ts";

const EVENT_ID = "7fc0a10f-88c5-4a64-9890-bc8c3fd8ee9d";

test("claims a pending webhook event", async () => {
  const calls: Array<{
    functionName: string;
    parameters: Record<string, unknown>;
  }> = [];
  const rpc: WhatsappInboxRpc = async (functionName, parameters) => {
    calls.push({ functionName, parameters });
    return {
      data: [
        {
          outcome: "claimed",
          event_id: EVENT_ID,
          raw_payload: { object: "whatsapp_business_account", entry: [] },
        },
      ],
      error: null,
    };
  };

  const result = await createWhatsappInboxRepository(
    rpc,
  ).claimWhatsappWebhookEvent(EVENT_ID);

  assert.deepEqual(result, {
    outcome: "claimed",
    eventId: EVENT_ID,
    rawPayload: { object: "whatsapp_business_account", entry: [] },
  });
  assert.deepEqual(calls, [
    {
      functionName: "claim_whatsapp_webhook_event",
      parameters: { p_event_id: EVENT_ID },
    },
  ]);
});

test("normalizes an unavailable claim", async () => {
  const repository = createWhatsappInboxRepository(async () => ({
    data: [
      { outcome: "unavailable", event_id: EVENT_ID, raw_payload: null },
    ],
    error: null,
  }));

  assert.deepEqual(await repository.claimWhatsappWebhookEvent(EVENT_ID), {
    outcome: "unavailable",
    eventId: EVENT_ID,
    rawPayload: null,
  });
});

test("rejects an invalid UUID before calling Supabase", async () => {
  let callCount = 0;
  const repository = createWhatsappInboxRepository(async () => {
    callCount += 1;
    return { data: null, error: null };
  });

  await assert.rejects(
    repository.claimWhatsappWebhookEvent("not-a-uuid"),
    /Invalid WhatsApp inbox event ID/,
  );
  assert.equal(callCount, 0);
});

test("completes a processing webhook event", async () => {
  const repository = createWhatsappInboxRepository(
    async (functionName, parameters) => {
      assert.equal(functionName, "complete_whatsapp_webhook_event");
      assert.deepEqual(parameters, { p_event_id: EVENT_ID });
      return {
        data: [{ outcome: "completed", event_id: EVENT_ID }],
        error: null,
      };
    },
  );

  assert.deepEqual(await repository.completeWhatsappWebhookEvent(EVENT_ID), {
    outcome: "completed",
    eventId: EVENT_ID,
  });
});

test("fails a processing webhook event with a safe error code", async () => {
  const repository = createWhatsappInboxRepository(
    async (functionName, parameters) => {
      assert.equal(functionName, "fail_whatsapp_webhook_event");
      assert.deepEqual(parameters, {
        p_event_id: EVENT_ID,
        p_error_code: "normalization_failed",
      });
      return {
        data: [{ outcome: "failed", event_id: EVENT_ID }],
        error: null,
      };
    },
  );

  assert.deepEqual(
    await repository.failWhatsappWebhookEvent(
      EVENT_ID,
      "normalization_failed",
    ),
    { outcome: "failed", eventId: EVENT_ID },
  );
});

test("throws a safe error for a malformed RPC result", async () => {
  const repository = createWhatsappInboxRepository(async () => ({
    data: [{ outcome: "claimed", event_id: EVENT_ID, raw_payload: [] }],
    error: null,
  }));

  await assert.rejects(
    repository.claimWhatsappWebhookEvent(EVENT_ID),
    /^Error: WhatsApp inbox repository operation failed\.$/,
  );
});

test("throws a safe error when Supabase returns a database error", async () => {
  const repository = createWhatsappInboxRepository(async () => ({
    data: null,
    error: { message: "permission denied for webhook_private secret-row" },
  }));

  await assert.rejects(
    repository.completeWhatsappWebhookEvent(EVENT_ID),
    /^Error: WhatsApp inbox repository operation failed\.$/,
  );
});

test("does not leak thrown database error details", async () => {
  const sensitiveDetail = "raw customer payload and database stack trace";
  const repository = createWhatsappInboxRepository(async () => {
    throw new Error(sensitiveDetail);
  });

  await assert.rejects(
    repository.failWhatsappWebhookEvent(EVENT_ID, "processing_failed"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "WhatsApp inbox repository operation failed.",
      );
      assert.equal(error.message.includes(sensitiveDetail), false);
      return true;
    },
  );
});
