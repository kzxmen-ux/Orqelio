import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createWhatsappInboxRecoveryCandidateFinder,
  recoverWhatsappInboxWithDependencies,
  type WhatsappInboxRecoveryRpc,
} from "./inbox-recovery-core.ts";
import { createWhatsappInboxRecoveryGetHandler } from "../../../app/api/internal/cron/whatsapp-inbox-recovery/route-core.ts";

const EVENT_ONE = "11111111-1111-4111-8111-111111111111";
const EVENT_TWO = "22222222-2222-4222-8222-222222222222";
const EVENT_THREE = "33333333-3333-4333-8333-333333333333";
const RECOVERY_MIGRATION_URL = new URL(
  "../../../../supabase/migrations/20260823182530_whatsapp_inbox_recovery.sql",
  import.meta.url,
);

async function readRecoveryMigration(): Promise<string> {
  return readFile(RECOVERY_MIGRATION_URL, "utf8");
}

function requireRecoveryFunction(migration: string): string {
  const recoveryFunction = migration.match(
    /create function webhook_private\.recover_whatsapp_webhook_inbox_internal\([\s\S]*?\n\$\$;/,
  )?.[0];

  assert.ok(recoveryFunction);
  return recoveryFunction;
}

test("recovery RPC returns validated candidates and bounds the requested limit", async () => {
  const calls: Array<{ functionName: string; limit: number }> = [];
  const rpc: WhatsappInboxRecoveryRpc = async (functionName, parameters) => {
    calls.push({ functionName, limit: parameters.p_limit });
    return {
      data: [{ event_id: EVENT_ONE }, { event_id: EVENT_TWO }],
      error: null,
    };
  };
  const findCandidates = createWhatsappInboxRecoveryCandidateFinder(rpc);

  assert.deepEqual(await findCandidates(500), [EVENT_ONE, EVENT_TWO]);
  assert.deepEqual(calls, [
    { functionName: "recover_whatsapp_webhook_inbox", limit: 50 },
  ]);
});

test("recovery processes candidates sequentially and aggregates safe counters", async () => {
  const order: string[] = [];
  let activeProcessors = 0;
  let maximumActiveProcessors = 0;

  const result = await recoverWhatsappInboxWithDependencies({
    findCandidates: async (limit) => {
      assert.equal(limit, 25);
      return [EVENT_ONE, EVENT_TWO, EVENT_THREE];
    },
    processEvent: async (eventId) => {
      activeProcessors += 1;
      maximumActiveProcessors = Math.max(
        maximumActiveProcessors,
        activeProcessors,
      );
      order.push(`start:${eventId}`);
      await Promise.resolve();
      order.push(`end:${eventId}`);
      activeProcessors -= 1;

      return {
        outcome: eventId === EVENT_TWO ? "unavailable" : "processed",
      };
    },
  });

  assert.equal(maximumActiveProcessors, 1);
  assert.deepEqual(order, [
    `start:${EVENT_ONE}`,
    `end:${EVENT_ONE}`,
    `start:${EVENT_TWO}`,
    `end:${EVENT_TWO}`,
    `start:${EVENT_THREE}`,
    `end:${EVENT_THREE}`,
  ]);
  assert.deepEqual(result, {
    candidateCount: 3,
    processedCount: 2,
    unavailableCount: 1,
    failedCount: 0,
  });
});

test("recovery continues after one processor failure without leaking details", async () => {
  const sensitiveDetail = "raw customer payload and database internals";
  const processed: string[] = [];

  const result = await recoverWhatsappInboxWithDependencies({
    findCandidates: async () => [EVENT_ONE, EVENT_TWO],
    processEvent: async (eventId) => {
      processed.push(eventId);
      if (eventId === EVENT_ONE) {
        throw new Error(sensitiveDetail);
      }
      return { outcome: "processed" };
    },
  });

  assert.deepEqual(processed, [EVENT_ONE, EVENT_TWO]);
  assert.deepEqual(result, {
    candidateCount: 2,
    processedCount: 1,
    unavailableCount: 0,
    failedCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(sensitiveDetail));
});

test("repeated recovery discovery remains safe because claim outcome is authoritative", async () => {
  let processorCalls = 0;
  const dependencies = {
    findCandidates: async () => [EVENT_ONE],
    processEvent: async () => {
      processorCalls += 1;
      return {
        outcome: processorCalls === 1 ? "processed" : "unavailable",
      } as const;
    },
  };

  const first = await recoverWhatsappInboxWithDependencies(dependencies);
  const second = await recoverWhatsappInboxWithDependencies(dependencies);

  assert.equal(first.processedCount, 1);
  assert.equal(second.processedCount, 0);
  assert.equal(second.unavailableCount, 1);
  assert.equal(processorCalls, 2);
});

test("malformed or failed recovery RPC throws only a safe error", async () => {
  const sensitiveDetail = "provider database secret detail";
  const malformedFinder = createWhatsappInboxRecoveryCandidateFinder(
    async () => ({ data: [{ event_id: sensitiveDetail }], error: null }),
  );
  const failedFinder = createWhatsappInboxRecoveryCandidateFinder(async () => ({
    data: null,
    error: { message: sensitiveDetail },
  }));

  await assert.rejects(malformedFinder(25), (error: unknown) => {
    assert.equal(
      error instanceof Error ? error.message : "",
      "WhatsApp inbox recovery failed.",
    );
    return true;
  });
  await assert.rejects(failedFinder(25), (error: unknown) => {
    assert.equal(
      error instanceof Error ? error.message : "",
      "WhatsApp inbox recovery failed.",
    );
    return true;
  });
});

test("recovery route requires the exact bearer secret and returns safe counters", async () => {
  let recoveryCalls = 0;
  const handler = createWhatsappInboxRecoveryGetHandler({
    getCronSecret: () => "cron-secret",
    recoverInbox: async () => {
      recoveryCalls += 1;
      return {
        candidateCount: 2,
        processedCount: 1,
        unavailableCount: 1,
        failedCount: 0,
      };
    },
  });

  const unauthorized = await handler(
    new Request("https://example.test/internal", {
      headers: { authorization: "Bearer wrong-secret" },
    }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");
  assert.equal(recoveryCalls, 0);

  const missingAuthorization = await handler(
    new Request("https://example.test/internal"),
  );
  assert.equal(missingAuthorization.status, 401);
  assert.equal(recoveryCalls, 0);

  const response = await handler(
    new Request("https://example.test/internal", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    candidateCount: 2,
    processedCount: 1,
    unavailableCount: 1,
    failedCount: 0,
  });
  assert.equal(recoveryCalls, 1);
});

test("recovery route hides missing configuration and internal failures", async () => {
  const sensitiveSecret = "do-not-reflect-cron-secret";
  const unavailableHandler = createWhatsappInboxRecoveryGetHandler({
    getCronSecret: () => {
      throw new Error(sensitiveSecret);
    },
    recoverInbox: async () => {
      throw new Error("must not run");
    },
  });
  const unavailable = await unavailableHandler(
    new Request("https://example.test/internal"),
  );
  const unavailableBody = await unavailable.text();
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(unavailableBody, new RegExp(sensitiveSecret));

  const failureHandler = createWhatsappInboxRecoveryGetHandler({
    getCronSecret: () => sensitiveSecret,
    recoverInbox: async () => {
      throw new Error("raw payload and database credentials");
    },
  });
  const failure = await failureHandler(
    new Request("https://example.test/internal", {
      headers: { authorization: `Bearer ${sensitiveSecret}` },
    }),
  );
  const failureBody = await failure.text();
  assert.equal(failure.status, 500);
  assert.equal(failure.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(failureBody, /payload|credentials|do-not-reflect/);
});

test("migration defines bounded durable lifecycle recovery and narrow grants", async () => {
  const migration = await readRecoveryMigration();

  assert.match(migration, /add column processing_started_at timestamptz/);
  assert.match(
    migration,
    /add column attempt_count integer not null default 0/,
  );
  assert.match(migration, /check \(attempt_count >= 0\)/);
  assert.match(
    migration,
    /processing_status = 'processing' and processing_started_at is not null/,
  );
  assert.match(migration, /processing_started_at = clock_timestamp\(\)/);
  assert.match(migration, /attempt_count = inbox\.attempt_count \+ 1/);
  assert.match(
    migration,
    /processing_status = 'processed',[\s\S]*processing_started_at = null,[\s\S]*processed_at = clock_timestamp\(\)/,
  );
  assert.match(
    migration,
    /processing_status = 'failed',[\s\S]*processing_started_at = null,[\s\S]*error_code = target_error_code/,
  );
  assert.match(
    migration,
    /processing_started_at <= recovery_time - interval '10 minutes'/,
  );
  assert.match(migration, /when inbox\.attempt_count < 5 then 'pending'/);
  assert.match(migration, /else 'recovery_attempts_exhausted'/);
  assert.match(
    migration,
    /received_at <= recovery_time - interval '1 minute'/,
  );
  assert.match(migration, /order by inbox\.received_at, inbox\.id/);
  assert.match(
    migration,
    /least\(50, greatest\(1, coalesce\(target_limit, 25\)\)\)/,
  );
  assert.match(
    migration,
    /create function public\.recover_whatsapp_webhook_inbox\([\s\S]*returns table \(event_id uuid\)/,
  );
  assert.match(
    migration,
    /revoke all[\s\S]*public\.recover_whatsapp_webhook_inbox\(integer\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute[\s\S]*public\.recover_whatsapp_webhook_inbox\(integer\)[\s\S]*to service_role/,
  );
});

test("migration requeues only the four known processor failures after one minute", async () => {
  const recoveryFunction = requireRecoveryFunction(
    await readRecoveryMigration(),
  );
  const retryableFailureCodes = [
    "routing_failed",
    "message_storage_failed",
    "status_routing_failed",
    "status_storage_failed",
  ] as const;

  assert.match(
    recoveryFunction,
    /where inbox\.processing_status = 'failed'/,
  );
  assert.match(
    recoveryFunction,
    /inbox\.processed_at <= recovery_time - interval '1 minute'/,
  );
  assert.match(
    recoveryFunction,
    /when inbox\.attempt_count < 5 then 'pending'/,
  );
  assert.match(
    recoveryFunction,
    /when inbox\.attempt_count < 5 then null[\s\S]*else inbox\.processed_at/,
  );

  for (const errorCode of retryableFailureCodes) {
    assert.match(recoveryFunction, new RegExp(`'${errorCode}'`));
  }

  const retryableCodeList = recoveryFunction.match(
    /inbox\.error_code in \(([\s\S]*?)\)/,
  )?.[1];
  assert.ok(retryableCodeList);
  assert.deepEqual(
    [...retryableCodeList.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    retryableFailureCodes,
  );
});

test("migration leaves young and unknown failures untouched", async () => {
  const recoveryFunction = requireRecoveryFunction(
    await readRecoveryMigration(),
  );
  const failedRecoveryPredicate = recoveryFunction.match(
    /where inbox\.processing_status = 'failed'[\s\S]*?interval '1 minute';/,
  )?.[0];

  assert.ok(failedRecoveryPredicate);
  assert.match(
    failedRecoveryPredicate,
    /inbox\.error_code in \([\s\S]*'status_storage_failed'[\s\S]*\)/,
  );
  assert.match(
    failedRecoveryPredicate,
    /inbox\.processed_at <= recovery_time - interval '1 minute'/,
  );
  assert.doesNotMatch(failedRecoveryPredicate, /unknown_failed/);
  assert.doesNotMatch(failedRecoveryPredicate, /recovery_attempts_exhausted/);
});

test("migration exhausts the fifth attempt and never requeues exhaustion", async () => {
  const recoveryFunction = requireRecoveryFunction(
    await readRecoveryMigration(),
  );
  const retryableCodeList = recoveryFunction.match(
    /inbox\.error_code in \(([\s\S]*?)\)/,
  )?.[1];

  assert.ok(retryableCodeList);
  assert.match(
    recoveryFunction,
    /when inbox\.attempt_count < 5 then 'pending'[\s\S]*else 'failed'/,
  );
  assert.match(
    recoveryFunction,
    /when inbox\.attempt_count < 5 then null[\s\S]*else 'recovery_attempts_exhausted'/,
  );
  assert.doesNotMatch(retryableCodeList, /recovery_attempts_exhausted/);
});

test("requeued failures can be returned without exposing raw payload", async () => {
  const migration = await readRecoveryMigration();
  const recoveryFunction = requireRecoveryFunction(migration);
  const publicRecoveryFunction = migration.match(
    /create function public\.recover_whatsapp_webhook_inbox\([\s\S]*?\n\$\$;/,
  )?.[0];

  assert.ok(publicRecoveryFunction);
  assert.match(
    recoveryFunction,
    /processing_status = case[\s\S]*then 'pending'[\s\S]*return query[\s\S]*where inbox\.processing_status = 'pending'/,
  );
  assert.match(
    recoveryFunction,
    /where inbox\.processing_status = 'processing'[\s\S]*processing_started_at <= recovery_time - interval '10 minutes'/,
  );
  assert.doesNotMatch(recoveryFunction, /raw_payload/);
  assert.doesNotMatch(publicRecoveryFunction, /raw_payload/);
});

test("normal webhook route keeps the Next.js after dispatch path", async () => {
  const route = await readFile(
    new URL("../../../app/api/webhooks/whatsapp/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /await processWhatsappInboxEvent\(eventId\)/);
  assert.match(route, /scheduleProcessing: scheduleWhatsappInboxProcessing/);
});
