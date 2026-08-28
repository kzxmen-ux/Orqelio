import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAiReplyWhatsappExecutionRecoveryGetHandler } from "../../../app/api/internal/cron/ai-reply-whatsapp-execution-recovery/route-core.ts";

const SAFE_COUNTERS = {
  quarantinedCount: 1,
  candidateCount: 2,
  persistedCount: 3,
  providerAcceptedCount: 4,
  alreadyDispatchingCount: 5,
  indeterminateCount: 6,
  failedCount: 7,
};
const ROUTE_URL = new URL(
  "../../../app/api/internal/cron/ai-reply-whatsapp-execution-recovery/route.ts",
  import.meta.url,
);
const ROUTE_CORE_URL = new URL(
  "../../../app/api/internal/cron/ai-reply-whatsapp-execution-recovery/route-core.ts",
  import.meta.url,
);

test("exact bearer secret succeeds and unauthorized requests never run recovery", async () => {
  let recoveryCalls = 0;
  const handler = createAiReplyWhatsappExecutionRecoveryGetHandler({
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

test("missing CRON_SECRET returns a non-cacheable 503 without running recovery", async () => {
  const sensitive = "missing CRON_SECRET detail";
  let recoveryCalls = 0;
  const handler = createAiReplyWhatsappExecutionRecoveryGetHandler({
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
  assert.deepEqual(JSON.parse(body), { error: "service_unavailable" });
  assert.equal(body.includes(sensitive), false);
});

test("worker exceptions return only a non-cacheable internal error", async () => {
  const sensitive = "raw Meta, database, provider, and customer detail";
  const handler = createAiReplyWhatsappExecutionRecoveryGetHandler({
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

test("success projects seven safe counters and always uses batch size one", async () => {
  const limits: number[] = [];
  const workerResult = {
    ...SAFE_COUNTERS,
    organizationId: "must-not-return",
    providerMessageId: "must-not-return",
    text: "must-not-return",
  };
  const handler = createAiReplyWhatsappExecutionRecoveryGetHandler({
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
  assert.deepEqual(Object.keys(body).sort(), Object.keys(SAFE_COUNTERS).sort());
  assert.equal(JSON.stringify(body).includes("must-not-return"), false);
});

test("production route is protected, bounded, and has no automatic send wiring", async () => {
  const routeSource = (await readFile(ROUTE_URL, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();
  const coreSource = (await readFile(ROUTE_CORE_URL, "utf8"))
    .replace(/\s+/g, " ")
    .toLowerCase();
  const combinedSource = `${routeSource} ${coreSource}`;

  assert.match(
    routeSource,
    /import \{ runaireplywhatsappexecutionworker \} from "@\/features\/messaging\/whatsapp\/ai-reply-whatsapp-execution-worker"/,
  );
  assert.match(
    routeSource,
    /import \{ getcronsecret \} from "@\/lib\/env\/server"/,
  );
  assert.match(routeSource, /export const dynamic = "force-dynamic"/);
  assert.match(routeSource, /export const runtime = "nodejs"/);
  assert.match(coreSource, /runrecovery\(1\)/);
  assert.match(coreSource, /timingsafeequal/);

  for (const forbidden of [
    "pg_cron",
    "vercel.json",
    "scheduler",
    "inbox-processor",
    "@/features/ai-runtime",
    "graph.facebook",
    "fetch(",
    "outbound-text-sender",
    "ai-reply-whatsapp-executor",
    "sendwhatsapptext",
    "createprivilegedclient",
    ".from(",
    ".rpc(",
  ]) {
    assert.equal(combinedSource.includes(forbidden), false);
  }
});
