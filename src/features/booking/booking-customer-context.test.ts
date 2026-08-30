import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  loadBookingCustomerContextCore,
  type BookingCustomerContextDependencies,
} from "./booking-customer-context-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCTION_PATH = new URL("./booking-customer-context.ts", import.meta.url);

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONVERSATION_ID,
    organization_id: ORGANIZATION_ID,
    channel: "whatsapp",
    channel_connection_id: CONNECTION_ID,
    external_participant_id: "77001234567",
    display_name: "Клиент",
    connection: {
      id: CONNECTION_ID,
      organization_id: ORGANIZATION_ID,
      status: "active",
    },
    ...overrides,
  };
}

function dependencies(
  rows: unknown,
): BookingCustomerContextDependencies {
  return { loadConversationRows: async () => rows };
}

test("loads the exact organization/conversation binding and exposes only customer context", async () => {
  const calls: unknown[] = [];
  const result = await loadBookingCustomerContextCore(
    ORGANIZATION_ID,
    CONVERSATION_ID,
    {
      loadConversationRows: async (organizationId, conversationId) => {
        calls.push({ organizationId, conversationId });
        return [row()];
      },
    },
  );

  assert.deepEqual(calls, [
    { organizationId: ORGANIZATION_ID, conversationId: CONVERSATION_ID },
  ]);
  assert.deepEqual(result, {
    success: true,
    context: { phone: "77001234567", displayName: "Клиент" },
  });
  if (result.success) {
    assert.deepEqual(Object.keys(result.context).sort(), ["displayName", "phone"]);
    assert.equal("connectionId" in result.context, false);
    assert.equal("organizationId" in result.context, false);
  }
});

test("rejects wrong tenant, conversation, or bound connection identity", async () => {
  const invalidRows = [
    row({ organization_id: "44444444-4444-4444-8444-444444444444" }),
    row({ id: "55555555-5555-4555-8555-555555555555" }),
    row({ channel_connection_id: "66666666-6666-4666-8666-666666666666" }),
    row({
      connection: {
        id: CONNECTION_ID,
        organization_id: "44444444-4444-4444-8444-444444444444",
        status: "active",
      },
    }),
  ];

  for (const invalidRow of invalidRows) {
    assert.deepEqual(
      await loadBookingCustomerContextCore(
        ORGANIZATION_ID,
        CONVERSATION_ID,
        dependencies([invalidRow]),
      ),
      { success: false, code: "customer_context_unavailable" },
    );
  }
});

test("rejects inactive connections and non-WhatsApp conversations", async () => {
  for (const invalidRow of [
    row({ channel: "telegram" }),
    row({
      connection: {
        id: CONNECTION_ID,
        organization_id: ORGANIZATION_ID,
        status: "suspended",
      },
    }),
    row({
      connection: {
        id: CONNECTION_ID,
        organization_id: ORGANIZATION_ID,
        status: "disconnected",
      },
    }),
  ]) {
    assert.deepEqual(
      await loadBookingCustomerContextCore(
        ORGANIZATION_ID,
        CONVERSATION_ID,
        dependencies([invalidRow]),
      ),
      { success: false, code: "customer_context_unavailable" },
    );
  }
});

test("uses only the trusted conversation participant phone and normalizes whitespace", async () => {
  const result = await loadBookingCustomerContextCore(
    ORGANIZATION_ID,
    CONVERSATION_ID,
    dependencies([
      row({ external_participant_id: "  77009998877  " }),
    ]),
  );

  assert.deepEqual(result, {
    success: true,
    context: { phone: "77009998877", displayName: "Клиент" },
  });
});

test("trims display names and converts absent or blank names to null", async () => {
  for (const [display_name, displayName] of [
    ["  Айдана  ", "Айдана"],
    ["   ", null],
    [null, null],
  ] as const) {
    assert.deepEqual(
      await loadBookingCustomerContextCore(
        ORGANIZATION_ID,
        CONVERSATION_ID,
        dependencies([row({ display_name })]),
      ),
      {
        success: true,
        context: { phone: "77001234567", displayName },
      },
    );
  }
});

test("rejects malformed, missing, duplicate, and invalid-phone rows safely", async () => {
  for (const rows of [
    null,
    [],
    [null],
    [{}],
    [row(), row()],
    [row({ external_participant_id: "+7 700 123 45 67" })],
    [row({ external_participant_id: "1".repeat(33) })],
    [row({ display_name: 42 })],
    [row({ connection: null })],
  ]) {
    assert.deepEqual(
      await loadBookingCustomerContextCore(
        ORGANIZATION_ID,
        CONVERSATION_ID,
        dependencies(rows),
      ),
      { success: false, code: "customer_context_unavailable" },
    );
  }
});

test("invalid identifiers and query exceptions return only the generic safe failure", async () => {
  let queryCalls = 0;
  const invalid = await loadBookingCustomerContextCore(
    "not-a-uuid",
    CONVERSATION_ID,
    {
      loadConversationRows: async () => {
        queryCalls += 1;
        return [row()];
      },
    },
  );
  assert.equal(queryCalls, 0);
  assert.deepEqual(invalid, {
    success: false,
    code: "customer_context_unavailable",
  });

  const failed = await loadBookingCustomerContextCore(
    ORGANIZATION_ID,
    CONVERSATION_ID,
    {
      loadConversationRows: async () => {
        throw new Error("raw database and customer details");
      },
    },
  );
  assert.deepEqual(failed, {
    success: false,
    code: "customer_context_unavailable",
  });
  assert.doesNotMatch(JSON.stringify(failed), /database|customer details/i);
});

test("production loader is server-only, privileged, narrowly scoped, and never references AI phone", () => {
  const productionSource = readFileSync(PRODUCTION_PATH, "utf8");
  const coreSource = readFileSync(
    new URL("./booking-customer-context-core.ts", import.meta.url),
    "utf8",
  );

  assert.match(productionSource, /^import "server-only";/);
  assert.match(productionSource, /createPrivilegedClient/);
  assert.match(productionSource, /\.from\("conversations"\)/);
  assert.match(productionSource, /external_participant_id/);
  assert.match(productionSource, /connection\.status", "active"/);
  assert.match(productionSource, /\.eq\("id", conversationId\)/);
  assert.match(productionSource, /\.eq\("organization_id", organizationId\)/);
  assert.match(productionSource, /\.eq\("channel", "whatsapp"\)/);
  assert.doesNotMatch(
    `${productionSource}\n${coreSource}`,
    /bookingRequest|customerPhone|waba_id|phone_number_id|credential/i,
  );
});
