import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyWhatsappDeliveryStatusWithRpc } from "./delivery-status-repository-core.ts";
import { routeWhatsappDeliveryStatusesWithResolver } from "./delivery-status-routing-core.ts";
import {
  processDurableAiInboundMessageWithDependencies,
  type DurableAiInboundProcessingResult,
} from "../../ai-runtime/durable-inbound-processing-core.ts";
import type { AiInboundProcessingInput } from "../../ai-runtime/inbound-processing-core.ts";
import {
  getImmediateAiReplyWhatsappExecutionCandidate,
  processWhatsappInboxEventWithDependencies,
  type WhatsappInboxProcessorDependencies,
} from "./inbox-processor-core.ts";

type TestMessage = {
  id: string;
  organizationId?: string;
  type?: string;
};

type TestStatus = {
  id: string;
};

const EVENT_ID = "27c85dd2-d2f5-4e28-a1f0-b970643c3115";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "55555555-5555-4555-8555-555555555555";
const RAW_PAYLOAD = { object: "whatsapp_business_account", entry: [] };
const SAFE_PROCESSOR_ERROR = /^Error: WhatsApp inbox processor failed\.$/;
const MIGRATION_URL = new URL(
  "../../../../supabase/migrations/20260822202836_whatsapp_outbound_delivery_status.sql",
  import.meta.url,
);
const MIGRATION_SQL = (await readFile(MIGRATION_URL, "utf8"))
  .replace(/\s+/g, " ")
  .toLowerCase();

function statusPayload(): Record<string, unknown> {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "123456789" },
              statuses: [
                {
                  id: "wamid.delivery-status",
                  recipient_id: "must-not-route-tenant",
                  status: "delivered",
                  timestamp: "1700000000",
                },
              ],
            },
          },
        ],
        id: "987654321",
      },
    ],
    object: "whatsapp_business_account",
  };
}

function createDependencies(
  overrides: Partial<
    WhatsappInboxProcessorDependencies<TestMessage, TestStatus>
  > = {},
): WhatsappInboxProcessorDependencies<TestMessage, TestStatus> {
  return {
    claimEvent: async () => ({
      outcome: "claimed",
      rawPayload: RAW_PAYLOAD,
    }),
    routePayload: async () => [],
    routeStatuses: async () => [],
    storeMessage: async () => ({
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      outcome: "accepted",
    }),
    storeStatus: async () => ({ outcome: "updated" }),
    processDurableAi: async () => {
      throw new Error("Unexpected AI processing call.");
    },
    completeEvent: async () => undefined,
    failEvent: async () => undefined,
    ...overrides,
  };
}

test("newly completed reply exposes only durable execution identity", () => {
  const input: AiInboundProcessingInput = {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    triggerMessageId: MESSAGE_ID,
  };
  const candidate = getImmediateAiReplyWhatsappExecutionCandidate(input, {
    outcome: "completed",
    runId: RUN_ID,
    aiResult: {
      outcome: "decided",
      decision: { action: "reply", text: "Не включать в candidate" },
    },
  });

  assert.deepEqual(candidate, {
    organizationId: ORGANIZATION_ID,
    aiMessageRunId: RUN_ID,
  });
  assert.deepEqual(Object.keys(candidate ?? {}).sort(), [
    "aiMessageRunId",
    "organizationId",
  ]);
  assert.equal(JSON.stringify(candidate).includes(CONVERSATION_ID), false);
  assert.equal(JSON.stringify(candidate).includes(MESSAGE_ID), false);
  assert.equal(JSON.stringify(candidate).includes("Не включать"), false);
});

test("immediate reply candidate excludes every non-new-reply outcome", () => {
  const input: AiInboundProcessingInput = {
    organizationId: ORGANIZATION_ID,
    conversationId: CONVERSATION_ID,
    triggerMessageId: MESSAGE_ID,
  };
  const excludedResults: DurableAiInboundProcessingResult[] = [
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: {
        outcome: "decided",
        decision: {
          action: "booking_action_required",
          bookingIntent: "create_appointment",
        },
      },
    },
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: {
        outcome: "decided",
        decision: {
          action: "handoff",
          reasonCode: "customer_requested_human",
          safeReason: "The customer requested a person.",
        },
      },
    },
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: {
        outcome: "decided",
        decision: {
          action: "no_safe_answer",
          reason: "model_cannot_answer",
        },
      },
    },
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: { outcome: "blocked", reason: "ai_configuration_missing" },
    },
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: { outcome: "failed", reason: "provider_error" },
    },
    { outcome: "already_processing", runId: RUN_ID },
    { outcome: "already_terminal", runId: RUN_ID, status: "decided" },
    { outcome: "already_terminal", runId: RUN_ID, status: "blocked" },
    { outcome: "already_terminal", runId: RUN_ID, status: "failed" },
  ];

  for (const durableResult of excludedResults) {
    assert.equal(
      getImmediateAiReplyWhatsappExecutionCandidate(input, durableResult),
      null,
    );
  }
});

test("processes a claimed event", async () => {
  let completedEventId: string | null = null;
  const message = { id: "message-1" };
  const dependencies = createDependencies({
    routePayload: async (payload) => {
      assert.equal(payload, RAW_PAYLOAD);
      return [message];
    },
    storeMessage: async (receivedMessage) => {
      assert.equal(receivedMessage, message);
      return {
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        outcome: "accepted",
      };
    },
    completeEvent: async (eventId) => {
      completedEventId = eventId;
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 1,
      storedMessageCount: 1,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [],
    },
  );
  assert.equal(completedEventId, EVENT_ID);
});

test("accepted text runs store, claim, runtime, terminal write, then completion", async () => {
  const operations: string[] = [];
  const aiInputs: unknown[] = [];
  const message = {
    id: "message-1",
    organizationId: ORGANIZATION_ID,
    type: "text",
  };
  const dependencies = createDependencies({
    routePayload: async () => [message],
    storeMessage: async () => {
      operations.push("store");
      return {
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        outcome: "accepted",
      };
    },
    processDurableAi: async (input) => {
      aiInputs.push(input);
      return processDurableAiInboundMessageWithDependencies(input, {
        claimRun: async () => {
          operations.push("claim");
          return {
            outcome: "claimed",
            runId: RUN_ID,
            status: "processing",
            attemptCount: 1,
          };
        },
        processAi: async () => {
          operations.push("runtime");
          return {
            outcome: "decided",
            decision: { action: "reply", text: "Здравствуйте!" },
          };
        },
        storeTerminalResult: async () => {
          operations.push("terminal");
          return { outcome: "stored", runId: RUN_ID, status: "decided" };
        },
      });
    },
    completeEvent: async () => {
      operations.push("complete");
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 1,
      storedMessageCount: 1,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [
        {
          outcome: "completed",
          runId: RUN_ID,
          aiResult: {
            outcome: "decided",
            decision: { action: "reply", text: "Здравствуйте!" },
          },
        },
      ],
    },
  );
  assert.deepEqual(operations, [
    "store",
    "claim",
    "runtime",
    "terminal",
    "complete",
  ]);
  assert.deepEqual(aiInputs, [
    {
      organizationId: ORGANIZATION_ID,
      conversationId: CONVERSATION_ID,
      triggerMessageId: MESSAGE_ID,
    },
  ]);
});

test("does not invoke AI when inbound text persistence fails", async () => {
  let aiCallCount = 0;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "fails", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    storeMessage: async () => {
      throw new Error("database details");
    },
    processDurableAi: async () => {
      aiCallCount += 1;
      return { outcome: "already_processing", runId: RUN_ID };
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.equal(aiCallCount, 0);
});

test("does not invoke AI for an unsupported inbound message type", async () => {
  let aiCallCount = 0;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "image", organizationId: ORGANIZATION_ID, type: "image" },
    ],
    processDurableAi: async () => {
      aiCallCount += 1;
      return { outcome: "already_processing", runId: RUN_ID };
    },
  });

  const result = await processWhatsappInboxEventWithDependencies(
    EVENT_ID,
    dependencies,
  );

  assert.equal(aiCallCount, 0);
  assert.deepEqual(result.aiProcessingResults, []);
});

test("keeps an AI failure explicit without failing the durable event", async () => {
  let completed = false;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "text", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    processDurableAi: async () => ({
      outcome: "completed",
      runId: RUN_ID,
      aiResult: { outcome: "failed", reason: "provider_error" },
    }),
    completeEvent: async () => {
      completed = true;
    },
  });

  const result = await processWhatsappInboxEventWithDependencies(
    EVENT_ID,
    dependencies,
  );

  assert.equal(completed, true);
  assert.deepEqual(result.aiProcessingResults, [
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: { outcome: "failed", reason: "provider_error" },
    },
  ]);
});

test("a durable orchestration exception prevents webhook completion safely", async () => {
  let completed = false;
  const sensitive = "raw repository error and customer data";
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "text", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    processDurableAi: async () => {
      throw new Error(sensitive);
    },
    completeEvent: async () => {
      completed = true;
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp inbox processor failed.");
      assert.equal(error.message.includes(sensitive), false);
      return true;
    },
  );
  assert.equal(completed, false);
});

test("returns unavailable without routing or completing", async () => {
  let downstreamCallCount = 0;
  const dependencies = createDependencies({
    claimEvent: async () => ({ outcome: "unavailable" }),
    routePayload: async () => {
      downstreamCallCount += 1;
      return [];
    },
    completeEvent: async () => {
      downstreamCallCount += 1;
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "unavailable",
      routedMessageCount: 0,
      storedMessageCount: 0,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [],
    },
  );
  assert.equal(downstreamCallCount, 0);
});

test("completes an event with zero routed messages", async () => {
  let completed = false;
  const dependencies = createDependencies({
    completeEvent: async () => {
      completed = true;
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 0,
      storedMessageCount: 0,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [],
    },
  );
  assert.equal(completed, true);
});

test("stores multiple routed messages sequentially in order", async () => {
  const messages = [{ id: "first" }, { id: "second" }, { id: "third" }];
  const storedIds: string[] = [];
  let activeStoreCount = 0;
  let maximumActiveStoreCount = 0;
  const dependencies = createDependencies({
    routePayload: async () => messages,
    storeMessage: async (message) => {
      activeStoreCount += 1;
      maximumActiveStoreCount = Math.max(
        maximumActiveStoreCount,
        activeStoreCount,
      );
      await Promise.resolve();
      storedIds.push(message.id);
      activeStoreCount -= 1;
      return {
        conversationId: CONVERSATION_ID,
        messageId: message.id,
        outcome: "accepted",
      };
    },
  });

  const result = await processWhatsappInboxEventWithDependencies(
    EVENT_ID,
    dependencies,
  );

  assert.deepEqual(storedIds, ["first", "second", "third"]);
  assert.equal(maximumActiveStoreCount, 1);
  assert.equal(result.storedMessageCount, 3);
});

test("duplicate text with no run claims and executes AI exactly once", async () => {
  const operations: string[] = [];
  let runtimeCalls = 0;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "duplicate", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    storeMessage: async () => {
      operations.push("store");
      return {
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        outcome: "duplicate",
      };
    },
    processDurableAi: async (input) => {
      return processDurableAiInboundMessageWithDependencies(input, {
        claimRun: async () => {
          operations.push("claim");
          return {
            outcome: "claimed",
            runId: RUN_ID,
            status: "processing",
            attemptCount: 1,
          };
        },
        processAi: async () => {
          operations.push("runtime");
          runtimeCalls += 1;
          return { outcome: "blocked", reason: "ai_configuration_missing" };
        },
        storeTerminalResult: async () => {
          operations.push("terminal");
          return { outcome: "stored", runId: RUN_ID, status: "blocked" };
        },
      });
    },
    completeEvent: async () => {
      operations.push("complete");
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 1,
      storedMessageCount: 1,
      routedStatusCount: 0,
      storedStatusCount: 0,
      aiProcessingResults: [
        {
          outcome: "completed",
          runId: RUN_ID,
          aiResult: {
            outcome: "blocked",
            reason: "ai_configuration_missing",
          },
        },
      ],
    },
  );
  assert.equal(runtimeCalls, 1);
  assert.deepEqual(operations, [
    "store",
    "claim",
    "runtime",
    "terminal",
    "complete",
  ]);
});

for (const messagePersistenceOutcome of ["accepted", "duplicate"] as const) {
  for (const claimOutcome of [
    "already_processing",
    "already_terminal",
  ] as const) {
    test(`${messagePersistenceOutcome} text + ${claimOutcome} does not run AI`, async () => {
      let runtimeCalls = 0;
      let terminalWrites = 0;
      let completed = false;
      const dependencies = createDependencies({
        routePayload: async () => [
          { id: "text", organizationId: ORGANIZATION_ID, type: "text" },
        ],
        storeMessage: async () => ({
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          outcome: messagePersistenceOutcome,
        }),
        processDurableAi: async (input) =>
          processDurableAiInboundMessageWithDependencies(input, {
            claimRun: async () =>
              claimOutcome === "already_processing"
                ? {
                    outcome: "already_processing",
                    runId: RUN_ID,
                    status: "processing",
                    attemptCount: 1,
                  }
                : {
                    outcome: "already_terminal",
                    runId: RUN_ID,
                    status: "decided",
                    attemptCount: 1,
                  },
            processAi: async () => {
              runtimeCalls += 1;
              return { outcome: "failed", reason: "runtime_error" };
            },
            storeTerminalResult: async () => {
              terminalWrites += 1;
              return {
                outcome: "stored",
                runId: RUN_ID,
                status: "failed",
              };
            },
          }),
        completeEvent: async () => {
          completed = true;
        },
      });

      const result = await processWhatsappInboxEventWithDependencies(
        EVENT_ID,
        dependencies,
      );

      assert.equal(runtimeCalls, 0);
      assert.equal(terminalWrites, 0);
      assert.equal(completed, true);
      assert.deepEqual(
        result.aiProcessingResults,
        claimOutcome === "already_processing"
          ? [{ outcome: "already_processing", runId: RUN_ID }]
          : [
              {
                outcome: "already_terminal",
                runId: RUN_ID,
                status: "decided",
              },
            ],
      );
    });
  }
}

test("claim persistence failure leaves the webhook event uncompleted", async () => {
  let completed = false;
  let failMarks = 0;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "text", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    processDurableAi: async (input) =>
      processDurableAiInboundMessageWithDependencies(input, {
        claimRun: async () => {
          throw new Error("raw claim RPC error and customer data");
        },
        processAi: async () => ({ outcome: "failed", reason: "runtime_error" }),
        storeTerminalResult: async () => ({
          outcome: "stored",
          runId: RUN_ID,
          status: "failed",
        }),
      }),
    completeEvent: async () => {
      completed = true;
    },
    failEvent: async () => {
      failMarks += 1;
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.equal(completed, false);
  assert.equal(failMarks, 0);
});

test("terminal persistence failure leaves the webhook event uncompleted", async () => {
  const operations: string[] = [];
  let failMarks = 0;
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "text", organizationId: ORGANIZATION_ID, type: "text" },
    ],
    storeMessage: async () => {
      operations.push("store");
      return {
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        outcome: "accepted",
      };
    },
    processDurableAi: async (input) =>
      processDurableAiInboundMessageWithDependencies(input, {
        claimRun: async () => {
          operations.push("claim");
          return {
            outcome: "claimed",
            runId: RUN_ID,
            status: "processing",
            attemptCount: 1,
          };
        },
        processAi: async () => {
          operations.push("runtime");
          return { outcome: "failed", reason: "provider_error" };
        },
        storeTerminalResult: async () => {
          operations.push("terminal");
          throw new Error("raw terminal RPC error and model details");
        },
      }),
    completeEvent: async () => {
      operations.push("complete");
    },
    failEvent: async () => {
      failMarks += 1;
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.deepEqual(operations, ["store", "claim", "runtime", "terminal"]);
  assert.equal(failMarks, 0);
});

test("marks a routing failure with the fixed safe code", async () => {
  const failCalls: Array<[string, string]> = [];
  const dependencies = createDependencies({
    routePayload: async () => {
      throw new Error("provider payload details");
    },
    failEvent: async (eventId, errorCode) => {
      failCalls.push([eventId, errorCode]);
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.deepEqual(failCalls, [[EVENT_ID, "routing_failed"]]);
});

test("marks a storage failure and stops before later messages", async () => {
  const storedIds: string[] = [];
  const failCalls: Array<[string, string]> = [];
  const dependencies = createDependencies({
    routePayload: async () => [
      { id: "stored" },
      { id: "fails" },
      { id: "must-not-run" },
    ],
    storeMessage: async (message) => {
      storedIds.push(message.id);
      if (message.id === "fails") {
        throw new Error("database details");
      }
      return {
        conversationId: CONVERSATION_ID,
        messageId: message.id,
        outcome: "accepted",
      };
    },
    failEvent: async (eventId, errorCode) => {
      failCalls.push([eventId, errorCode]);
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.deepEqual(storedIds, ["stored", "fails"]);
  assert.deepEqual(failCalls, [[EVENT_ID, "message_storage_failed"]]);
});

test("completes only after every message is stored", async () => {
  const operations: string[] = [];
  const dependencies = createDependencies({
    routePayload: async () => [{ id: "one" }, { id: "two" }],
    storeMessage: async (message) => {
      operations.push(`store:${message.id}`);
      return {
        conversationId: CONVERSATION_ID,
        messageId: message.id,
        outcome: "accepted",
      };
    },
    completeEvent: async () => {
      operations.push("complete");
    },
  });

  await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies);
  assert.deepEqual(operations, ["store:one", "store:two", "complete"]);
});

test("throws safely when completion fails", async () => {
  let failMarkCallCount = 0;
  const dependencies = createDependencies({
    completeEvent: async () => {
      throw new Error("internal completion SQL detail");
    },
    failEvent: async () => {
      failMarkCallCount += 1;
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.equal(failMarkCallCount, 0);
});

test("throws safely when failure marking itself fails", async () => {
  const dependencies = createDependencies({
    routePayload: async () => {
      throw new Error("routing secret");
    },
    failEvent: async () => {
      throw new Error("failure update database secret");
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
});

test("does not leak sensitive dependency error details", async () => {
  const sensitiveDetail = "raw customer message and private database stack";
  const dependencies = createDependencies({
    routePayload: async () => [{ id: "sensitive" }],
    storeMessage: async () => {
      throw new Error(sensitiveDetail);
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp inbox processor failed.");
      assert.equal(error.message.includes(sensitiveDetail), false);
      return true;
    },
  );
});

test("routes a delivery status through the exact active connection pair", async () => {
  const resolverInputs: unknown[] = [];
  const result = await routeWhatsappDeliveryStatusesWithResolver(
    statusPayload(),
    async (input) => {
      resolverInputs.push(input);
      return {
        connectionId: "33333333-3333-4333-8333-333333333333",
        organizationId: "11111111-1111-4111-8111-111111111111",
      };
    },
  );

  assert.deepEqual(resolverInputs, [
    { phoneNumberId: "123456789", wabaId: "987654321" },
  ]);
  assert.deepEqual(result, [
    {
      connectionId: "33333333-3333-4333-8333-333333333333",
      organizationId: "11111111-1111-4111-8111-111111111111",
      providerMessageId: "wamid.delivery-status",
      providerTimestamp: "2023-11-14T22:13:20.000Z",
      status: "delivered",
    },
  ]);
  assert.equal(JSON.stringify(resolverInputs).includes("recipient"), false);
});

test("skips a status without an active mapped connection", async () => {
  assert.deepEqual(
    await routeWhatsappDeliveryStatusesWithResolver(
      statusPayload(),
      async () => null,
    ),
    [],
  );
});

test("delivery status repository calls only the tenant-safe RPC", async () => {
  const calls: unknown[] = [];
  const result = await applyWhatsappDeliveryStatusWithRpc(
    {
      connectionId: "33333333-3333-4333-8333-333333333333",
      organizationId: "11111111-1111-4111-8111-111111111111",
      providerMessageId: "wamid.delivery-status",
      providerTimestamp: "2023-11-14T22:13:20.000Z",
      status: "delivered",
    },
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          {
            delivery_status: "delivered",
            message_id: "44444444-4444-4444-8444-444444444444",
            outcome: "updated",
          },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(result, {
    deliveryStatus: "delivered",
    messageId: "44444444-4444-4444-8444-444444444444",
    outcome: "updated",
  });
  assert.deepEqual(calls, [
    {
      functionName: "apply_whatsapp_outbound_delivery_status",
      parameters: {
        p_connection_id: "33333333-3333-4333-8333-333333333333",
        p_organization_id: "11111111-1111-4111-8111-111111111111",
        p_provider_message_id: "wamid.delivery-status",
        p_provider_status: "delivered",
        p_provider_timestamp: "2023-11-14T22:13:20.000Z",
      },
    },
  ]);
});

test("delivery status repository fails safely without database details", async () => {
  const sensitive = "private database row and provider routing values";
  let thrown: unknown;

  try {
    await applyWhatsappDeliveryStatusWithRpc(
      {
        connectionId: "33333333-3333-4333-8333-333333333333",
        organizationId: "11111111-1111-4111-8111-111111111111",
        providerMessageId: "wamid.delivery-status",
        providerTimestamp: "2023-11-14T22:13:20.000Z",
        status: "failed",
      },
      async () => ({ data: null, error: { message: sensitive } }),
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof Error);
  assert.equal(
    thrown.message,
    "WhatsApp delivery status repository operation failed.",
  );
  assert.equal(thrown.message.includes(sensitive), false);
});

test("invalid delivery status input is rejected before the RPC", async () => {
  let rpcCalls = 0;

  await assert.rejects(
    applyWhatsappDeliveryStatusWithRpc(
      {
        connectionId: "not-a-uuid",
        organizationId: "11111111-1111-4111-8111-111111111111",
        providerMessageId: "wamid.delivery-status",
        providerTimestamp: "2023-11-14T22:13:20.000Z",
        status: "sent",
      },
      async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    ),
    /^Error: WhatsApp delivery status repository operation failed\.$/,
  );
  assert.equal(rpcCalls, 0);
});

test("duplicate delivery status persistence is normalized as success", async () => {
  assert.deepEqual(
    await applyWhatsappDeliveryStatusWithRpc(
      {
        connectionId: "33333333-3333-4333-8333-333333333333",
        organizationId: "11111111-1111-4111-8111-111111111111",
        providerMessageId: "wamid.delivery-status",
        providerTimestamp: "2023-11-14T22:13:20.000Z",
        status: "sent",
      },
      async () => ({
        data: [
          {
            delivery_status: "sent",
            message_id: "44444444-4444-4444-8444-444444444444",
            outcome: "duplicate",
          },
        ],
        error: null,
      }),
    ),
    {
      deliveryStatus: "sent",
      messageId: "44444444-4444-4444-8444-444444444444",
      outcome: "duplicate",
    },
  );
});

test("status-only webhook is stored before the inbox event completes", async () => {
  const operations: string[] = [];
  const status = { id: "status-only" };
  const dependencies = createDependencies({
    routeStatuses: async () => [status],
    storeStatus: async (receivedStatus) => {
      assert.equal(receivedStatus, status);
      operations.push("status");
      return { outcome: "updated" };
    },
    completeEvent: async () => {
      operations.push("complete");
    },
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 0,
      storedMessageCount: 0,
      routedStatusCount: 1,
      storedStatusCount: 1,
      aiProcessingResults: [],
    },
  );
  assert.deepEqual(operations, ["status", "complete"]);
});

test("mixed webhook completes only after message and status stores", async () => {
  const operations: string[] = [];
  const dependencies = createDependencies({
    routePayload: async () => [{ id: "message" }],
    routeStatuses: async () => [{ id: "status" }],
    storeMessage: async () => {
      operations.push("message");
      return {
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        outcome: "accepted",
      };
    },
    storeStatus: async () => {
      operations.push("status");
      return { outcome: "updated" };
    },
    completeEvent: async () => {
      operations.push("complete");
    },
  });

  await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies);
  assert.deepEqual(operations, ["message", "status", "complete"]);
});

test("status storage failure marks the inbox event failed safely", async () => {
  const sensitive = "raw provider failure and customer identifiers";
  const failCalls: Array<[string, string]> = [];
  const dependencies = createDependencies({
    routeStatuses: async () => [{ id: "status" }],
    storeStatus: async () => {
      throw new Error(sensitive);
    },
    failEvent: async (eventId, errorCode) => {
      failCalls.push([eventId, errorCode]);
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "WhatsApp inbox processor failed.");
      assert.equal(error.message.includes(sensitive), false);
      return true;
    },
  );
  assert.deepEqual(failCalls, [[EVENT_ID, "status_storage_failed"]]);
});

test("status routing failure marks the inbox event failed safely", async () => {
  const sensitive = "private routing identifiers";
  const failCalls: Array<[string, string]> = [];
  const dependencies = createDependencies({
    routeStatuses: async () => {
      throw new Error(sensitive);
    },
    failEvent: async (eventId, errorCode) => {
      failCalls.push([eventId, errorCode]);
    },
  });

  await assert.rejects(
    processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    SAFE_PROCESSOR_ERROR,
  );
  assert.deepEqual(failCalls, [[EVENT_ID, "status_routing_failed"]]);
});

test("delivery migration adds outbound-only lifecycle timestamps", () => {
  assert.match(
    MIGRATION_SQL,
    /add column sent_at timestamptz, add column delivered_at timestamptz, add column read_at timestamptz, add column failed_at timestamptz/,
  );
  assert.match(
    MIGRATION_SQL,
    /direction = 'outbound' or \( sent_at is null and delivered_at is null and read_at is null and failed_at is null \)/,
  );
});

test("delivery migration locks and verifies the exact outbound tenant identity", () => {
  assert.match(MIGRATION_SQL, /for update of message/);
  assert.match(MIGRATION_SQL, /message\.organization_id = p_organization_id/);
  assert.match(MIGRATION_SQL, /message\.channel = 'whatsapp'/);
  assert.match(MIGRATION_SQL, /message\.direction = 'outbound'/);
  assert.match(
    MIGRATION_SQL,
    /message\.provider_message_id = p_provider_message_id/,
  );
  assert.match(
    MIGRATION_SQL,
    /conversation\.channel_connection_id = p_connection_id/,
  );
  assert.match(MIGRATION_SQL, /connection\.status = 'active'/);
  assert.match(
    MIGRATION_SQL,
    /raise exception 'whatsapp outbound delivery status target is unavailable'/,
  );
});

test("delivery migration stores earliest milestones without status regression", () => {
  for (const milestone of ["sent", "delivered", "read", "failed"]) {
    assert.match(
      MIGRATION_SQL,
      new RegExp(`least\\(current_${milestone}_at, p_provider_timestamp\\)`),
    );
  }

  assert.match(
    MIGRATION_SQL,
    /when next_read_at is not null then 'read' when next_delivered_at is not null then 'delivered' when next_failed_at is not null then 'failed' when next_sent_at is not null then 'sent' else 'accepted'/,
  );
  assert.match(
    MIGRATION_SQL,
    /if not milestone_changed and next_delivery_status = current_delivery_status then return query select 'duplicate'::text/,
  );
});

test("delivery RPC is executable only by service_role", () => {
  const signature =
    "public.apply_whatsapp_outbound_delivery_status( uuid, uuid, text, text, timestamptz )";

  assert.ok(
    MIGRATION_SQL.includes(
      `revoke all on function ${signature} from public, anon, authenticated`,
    ),
  );
  assert.ok(
    MIGRATION_SQL.includes(`grant execute on function ${signature} to service_role`),
  );
  assert.match(
    MIGRATION_SQL,
    /grant update \( sent_at, delivered_at, read_at, failed_at, delivery_status \) on public\.messages to service_role/,
  );
});
