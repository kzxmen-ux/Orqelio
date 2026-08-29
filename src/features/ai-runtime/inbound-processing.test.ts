import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  processAiInboundMessageWithDependencies,
  type AiInboundProcessingInput,
  type AiInboundProcessingResult,
} from "./inbound-processing-core.ts";
import { processDurableAiInboundMessageWithDependencies } from "./durable-inbound-processing-core.ts";

const INPUT: AiInboundProcessingInput = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  triggerMessageId: "33333333-3333-4333-8333-333333333333",
};
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const BOOKING_REQUEST = {
  serviceQuery: "стрижка",
  staffQuery: null,
  dateText: "завтра",
  timeText: "в 15:00",
  customerName: null,
  customerPhone: null,
  appointmentReference: null,
} as const;

test("passes only the technical identifiers and preserves a reply decision", async () => {
  const receivedInputs: unknown[] = [];

  const result = await processAiInboundMessageWithDependencies(INPUT, {
    runRuntime: async (input) => {
      receivedInputs.push(input);
      return {
        outcome: "decided",
        decision: { action: "reply", text: "Здравствуйте!" },
        model: "test-model",
        usage: null,
      };
    },
  });

  assert.deepEqual(receivedInputs, [INPUT]);
  assert.deepEqual(result, {
    outcome: "decided",
    decision: { action: "reply", text: "Здравствуйте!" },
  });
});

test("preserves booking_action_required as a decision only", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "decided",
        decision: {
          action: "booking_action_required",
          bookingIntent: "create_appointment",
          bookingRequest: BOOKING_REQUEST,
        },
        model: "test-model",
        usage: null,
      }),
    }),
    {
      outcome: "decided",
      decision: {
        action: "booking_action_required",
        bookingIntent: "create_appointment",
        bookingRequest: BOOKING_REQUEST,
      },
    },
  );
});

test("preserves handoff as a decision only", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "decided",
        decision: {
          action: "handoff",
          reasonCode: "customer_requested_human",
          safeReason: "The customer requested a person.",
        },
        model: "test-model",
        usage: null,
      }),
    }),
    {
      outcome: "decided",
      decision: {
        action: "handoff",
        reasonCode: "customer_requested_human",
        safeReason: "The customer requested a person.",
      },
    },
  );
});

test("represents blocked AI configuration with its safe reason", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "blocked",
        reason: "ai_configuration_missing",
      }),
    }),
    { outcome: "blocked", reason: "ai_configuration_missing" },
  );
});

test("represents an AI runtime failure with its safe reason", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => ({
        outcome: "failure",
        reason: "provider_error",
      }),
    }),
    { outcome: "failed", reason: "provider_error" },
  );
});

test("normalizes an unexpected runtime exception without leaking details", async () => {
  assert.deepEqual(
    await processAiInboundMessageWithDependencies(INPUT, {
      runRuntime: async () => {
        throw new Error("raw provider response and customer data");
      },
    }),
    { outcome: "failed", reason: "runtime_error" },
  );
});

test("durable orchestration claims, runs, and stores a reply in order", async () => {
  const operations: string[] = [];
  const terminalWrites: unknown[] = [];

  const result = await processDurableAiInboundMessageWithDependencies(INPUT, {
    claimRun: async (input) => {
      operations.push("claim");
      assert.deepEqual(input, INPUT);
      return {
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      };
    },
    processAi: async (input) => {
      operations.push("runtime");
      assert.deepEqual(input, INPUT);
      return {
        outcome: "decided",
        decision: { action: "reply", text: "Здравствуйте!" },
      };
    },
    storeTerminalResult: async (runId, aiResult) => {
      operations.push("terminal");
      terminalWrites.push({ runId, aiResult });
      return { outcome: "stored", runId: RUN_ID, status: "decided" };
    },
  });

  assert.deepEqual(operations, ["claim", "runtime", "terminal"]);
  assert.deepEqual(terminalWrites, [
    {
      runId: RUN_ID,
      aiResult: {
        outcome: "decided",
        decision: { action: "reply", text: "Здравствуйте!" },
      },
    },
  ]);
  assert.deepEqual(result, {
    outcome: "completed",
    runId: RUN_ID,
    aiResult: {
      outcome: "decided",
      decision: { action: "reply", text: "Здравствуйте!" },
    },
  });
});

test("already_processing skips runtime and terminal persistence", async () => {
  let downstreamCalls = 0;

  assert.deepEqual(
    await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "already_processing",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => {
        downstreamCalls += 1;
        return { outcome: "failed", reason: "runtime_error" };
      },
      storeTerminalResult: async () => {
        downstreamCalls += 1;
        return { outcome: "stored", runId: RUN_ID, status: "failed" };
      },
    }),
    { outcome: "already_processing", runId: RUN_ID },
  );
  assert.equal(downstreamCalls, 0);
});

test("already_terminal skips runtime and exposes only the safe status", async () => {
  let downstreamCalls = 0;

  assert.deepEqual(
    await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "already_terminal",
        runId: RUN_ID,
        status: "blocked",
        attemptCount: 1,
      }),
      processAi: async () => {
        downstreamCalls += 1;
        return { outcome: "failed", reason: "runtime_error" };
      },
      storeTerminalResult: async () => {
        downstreamCalls += 1;
        return { outcome: "stored", runId: RUN_ID, status: "failed" };
      },
    }),
    { outcome: "already_terminal", runId: RUN_ID, status: "blocked" },
  );
  assert.equal(downstreamCalls, 0);
});

test("booking and handoff decisions are persisted only as decided results", async () => {
  const decisions: AiInboundProcessingResult[] = [
    {
      outcome: "decided",
      decision: {
        action: "booking_action_required",
        bookingIntent: "create_appointment",
        bookingRequest: BOOKING_REQUEST,
      },
    },
    {
      outcome: "decided",
      decision: {
        action: "handoff",
        reasonCode: "customer_requested_human",
        safeReason: "The customer requested a person.",
      },
    },
  ];
  const stored: AiInboundProcessingResult[] = [];

  for (const decision of decisions) {
    const result = await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => decision,
      storeTerminalResult: async (_runId, aiResult) => {
        stored.push(aiResult);
        return { outcome: "stored", runId: RUN_ID, status: "decided" };
      },
    });

    assert.deepEqual(result, {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: decision,
    });
  }

  assert.deepEqual(stored, decisions);
});

test("blocked and runtime failures are persisted as valid terminal results", async () => {
  const safeResults: AiInboundProcessingResult[] = [
    { outcome: "blocked", reason: "ai_configuration_missing" },
    { outcome: "failed", reason: "provider_error" },
  ];
  const stored: AiInboundProcessingResult[] = [];

  for (const aiResult of safeResults) {
    const result = await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => aiResult,
      storeTerminalResult: async (_runId, received) => {
        stored.push(received);
        return {
          outcome: "stored",
          runId: RUN_ID,
          status: received.outcome,
        };
      },
    });

    assert.deepEqual(result, { outcome: "completed", runId: RUN_ID, aiResult });
  }

  assert.deepEqual(stored, safeResults);
});

test("an unexpected runtime exception is persisted as runtime_error", async () => {
  const stored: AiInboundProcessingResult[] = [];

  assert.deepEqual(
    await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => {
        throw new Error("raw OpenAI response and customer details");
      },
      storeTerminalResult: async (_runId, aiResult) => {
        stored.push(aiResult);
        return { outcome: "stored", runId: RUN_ID, status: "failed" };
      },
    }),
    {
      outcome: "completed",
      runId: RUN_ID,
      aiResult: { outcome: "failed", reason: "runtime_error" },
    },
  );
  assert.deepEqual(stored, [
    { outcome: "failed", reason: "runtime_error" },
  ]);
});

test("claim repository exceptions are safely normalized", async () => {
  const sensitive = "database row, raw prompt, and customer identifier";
  let downstreamCalls = 0;

  await assert.rejects(
    processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => {
        throw new Error(sensitive);
      },
      processAi: async () => {
        downstreamCalls += 1;
        return { outcome: "failed", reason: "runtime_error" };
      },
      storeTerminalResult: async () => {
        downstreamCalls += 1;
        return { outcome: "stored", runId: RUN_ID, status: "failed" };
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Durable AI inbound processing failed.");
      assert.equal(error.message.includes(sensitive), false);
      return true;
    },
  );
  assert.equal(downstreamCalls, 0);
});

test("terminal repository exceptions are safely normalized after one AI call", async () => {
  const sensitive = "raw database error and provider response";
  let aiCalls = 0;

  await assert.rejects(
    processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => {
        aiCalls += 1;
        return { outcome: "failed", reason: "provider_error" };
      },
      storeTerminalResult: async () => {
        throw new Error(sensitive);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Durable AI inbound processing failed.");
      assert.equal(error.message.includes(sensitive), false);
      return true;
    },
  );
  assert.equal(aiCalls, 1);
});

test("terminal result run identity mismatch fails safely", async () => {
  const mismatchedRunId = "55555555-5555-4555-8555-555555555555";

  await assert.rejects(
    processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => ({ outcome: "blocked", reason: "ai_configuration_missing" }),
      storeTerminalResult: async () => ({
        outcome: "stored",
        runId: mismatchedRunId,
        status: "blocked",
      }),
    }),
    /^Error: Durable AI inbound processing failed\.$/,
  );
});

test("a terminal write race returns already_terminal without another AI call", async () => {
  let aiCalls = 0;

  assert.deepEqual(
    await processDurableAiInboundMessageWithDependencies(INPUT, {
      claimRun: async () => ({
        outcome: "claimed",
        runId: RUN_ID,
        status: "processing",
        attemptCount: 1,
      }),
      processAi: async () => {
        aiCalls += 1;
        return { outcome: "failed", reason: "provider_error" };
      },
      storeTerminalResult: async () => ({
        outcome: "already_terminal",
        runId: RUN_ID,
        status: "decided",
      }),
    }),
    { outcome: "already_terminal", runId: RUN_ID, status: "decided" },
  );
  assert.equal(aiCalls, 1);
});

test("production orchestration contains no direct Meta, sender, or CRM dependency", async () => {
  const sourceUrls = [
    new URL("./inbound-processing.ts", import.meta.url),
    new URL("./durable-inbound-processing-core.ts", import.meta.url),
    new URL("./durable-inbound-processing.ts", import.meta.url),
    new URL("../messaging/whatsapp/inbox-processor-core.ts", import.meta.url),
    new URL("../messaging/whatsapp/inbox-processor.ts", import.meta.url),
  ];
  const sources = (await Promise.all(
    sourceUrls.map((url) => readFile(url, "utf8")),
  )).join("\n");

  assert.equal(
    sources.match(/getImmediateAiReplyWhatsappExecutionCandidate/g)?.length,
    2,
  );

  for (const forbidden of [
    "sendWhatsappTextMessage",
    "sendWhatsappConversationText",
    "MetaWhatsAppProvider",
    "outbound-message",
    "outbound-text",
    "outbound-text-sender",
    "integrations/crm",
    "graph.facebook.com",
    "fetch(",
    "message-run-recovery-worker",
    "/cron/",
  ]) {
    assert.equal(sources.includes(forbidden), false);
  }
});
