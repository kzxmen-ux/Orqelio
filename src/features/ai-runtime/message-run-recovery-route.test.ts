import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAiMessageRunRecoveryGetHandler } from "../../app/api/internal/cron/ai-message-run-recovery/route-core.ts";

const SAFE_COUNTERS = {
  recoveredRetryableCount: 1,
  exhaustedCount: 2,
  pendingCandidateCount: 3,
  completedCount: 4,
  alreadyProcessingCount: 5,
  alreadyTerminalCount: 6,
  failedCount: 7,
};
const ROUTE_URL = new URL(
  "../../app/api/internal/cron/ai-message-run-recovery/route.ts",
  import.meta.url,
);
const ROUTE_CORE_URL = new URL(
  "../../app/api/internal/cron/ai-message-run-recovery/route-core.ts",
  import.meta.url,
);

test("exact bearer secret succeeds and unauthorized requests never run recovery", async () => {
  let recoveryCalls = 0;
  const handler = createAiMessageRunRecoveryGetHandler({
    getCronSecret: () => "cron-secret",
    runRecovery: async () => {
      recoveryCalls += 1;
      return SAFE_COUNTERS;
    },
  });

  for (const headers of [
    undefined,
    { authorization: "Bearer wrong-secret" },
  ]) {
    const response = await handler(
      new Request("https://example.test/internal", { headers }),
    );

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  assert.equal(recoveryCalls, 0);

  const response = await handler(
    new Request("https://example.test/internal", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(recoveryCalls, 1);
});

test("missing CRON_SECRET returns a non-cacheable 503", async () => {
  const sensitive = "missing CRON_SECRET detail";
  let recoveryCalls = 0;
  const handler = createAiMessageRunRecoveryGetHandler({
    getCronSecret: () => {
      throw new Error(sensitive);
    },
    runRecovery: async () => {
      recoveryCalls += 1;
      return SAFE_COUNTERS;
    },
  });

  const response = await handler(
    new Request("https://example.test/internal", {
      headers: { authorization: "Bearer anything" },
    }),
  );
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(recoveryCalls, 0);
  assert.equal(body.includes(sensitive), false);
});

test("worker failures return a fixed non-cacheable 500 without raw details", async () => {
  const sensitive = "database, OpenAI, and customer details";
  const handler = createAiMessageRunRecoveryGetHandler({
    getCronSecret: () => "cron-secret",
    runRecovery: async () => {
      throw new Error(sensitive);
    },
  });

  const response = await handler(
    new Request("https://example.test/internal", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(JSON.parse(body), { error: "internal_error" });
  assert.equal(body.includes(sensitive), false);
});

test("success exposes only safe counters and always uses batch size one", async () => {
  const limits: number[] = [];
  const workerResult = {
    ...SAFE_COUNTERS,
    decision: "must-not-return",
    messageId: "must-not-return",
  };
  const handler = createAiMessageRunRecoveryGetHandler({
    getCronSecret: () => "cron-secret",
    runRecovery: async (limit) => {
      limits.push(limit);
      return workerResult;
    },
  });

  const response = await handler(
    new Request("https://example.test/internal?limit=50", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(limits, [1]);
  assert.deepEqual(body, SAFE_COUNTERS);
  assert.equal(JSON.stringify(body).includes("must-not-return"), false);
});

test("production route wires only the existing worker and CRON_SECRET getter", async () => {
  const source = `${await readFile(ROUTE_URL, "utf8")} ${await readFile(ROUTE_CORE_URL, "utf8")}`
    .replace(/\s+/g, " ")
    .toLowerCase();

  assert.match(
    source,
    /import \{ runaimessagerunrecoveryworker \} from "@\/features\/ai-runtime\/message-run-recovery-worker"/,
  );
  assert.match(
    source,
    /import \{ getcronsecret \} from "@\/lib\/env\/server"/,
  );
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const runtime = "nodejs"/);
  assert.match(source, /runrecovery\(1\)/);

  for (const forbidden of [
    "whatsapp",
    "meta",
    "graph api",
    "outbound",
    "crm",
    "booking",
    "pg_cron",
    "vercel cron",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
});
