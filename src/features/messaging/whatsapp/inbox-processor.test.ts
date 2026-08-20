import assert from "node:assert/strict";
import test from "node:test";

import {
  processWhatsappInboxEventWithDependencies,
  type WhatsappInboxProcessorDependencies,
} from "./inbox-processor-core.ts";

type TestMessage = {
  id: string;
};

const EVENT_ID = "27c85dd2-d2f5-4e28-a1f0-b970643c3115";
const RAW_PAYLOAD = { object: "whatsapp_business_account", entry: [] };
const SAFE_PROCESSOR_ERROR = /^Error: WhatsApp inbox processor failed\.$/;

function createDependencies(
  overrides: Partial<WhatsappInboxProcessorDependencies<TestMessage>> = {},
): WhatsappInboxProcessorDependencies<TestMessage> {
  return {
    claimEvent: async () => ({
      outcome: "claimed",
      rawPayload: RAW_PAYLOAD,
    }),
    routePayload: async () => [],
    storeMessage: async () => ({ outcome: "accepted" }),
    completeEvent: async () => undefined,
    failEvent: async () => undefined,
    ...overrides,
  };
}

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
      return { outcome: "accepted" };
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
    },
  );
  assert.equal(completedEventId, EVENT_ID);
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
      return { outcome: "accepted" };
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

test("counts duplicate message persistence as success", async () => {
  const dependencies = createDependencies({
    routePayload: async () => [{ id: "duplicate" }],
    storeMessage: async () => ({ outcome: "duplicate" }),
  });

  assert.deepEqual(
    await processWhatsappInboxEventWithDependencies(EVENT_ID, dependencies),
    {
      outcome: "processed",
      routedMessageCount: 1,
      storedMessageCount: 1,
    },
  );
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
      return { outcome: "accepted" };
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
      return { outcome: "accepted" };
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
