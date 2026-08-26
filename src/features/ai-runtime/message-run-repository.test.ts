import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AiInboundProcessingResult } from "./inbound-processing-core.ts";
import {
  claimAiMessageRunWithRpc,
  recoverStaleAiMessageRunsWithRpc,
  storeAiMessageRunTerminalResultWithRpc,
  type AiMessageRunRpc,
} from "./message-run-repository-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const INPUT = {
  organizationId: ORGANIZATION_ID,
  conversationId: CONVERSATION_ID,
  triggerMessageId: MESSAGE_ID,
};
const SAFE_REPOSITORY_ERROR = "AI message run repository operation failed.";
const MIGRATION_URL = new URL(
  "../../../supabase/migrations/20260826201736_ai_message_runs.sql",
  import.meta.url,
);
const MIGRATION_SQL = (await readFile(MIGRATION_URL, "utf8"))
  .replace(/\s+/g, " ")
  .toLowerCase();
const RECOVERY_MIGRATION_URL = new URL(
  "../../../supabase/migrations/20260826204647_ai_message_run_stale_recovery.sql",
  import.meta.url,
);
const RECOVERY_MIGRATION_SQL = (
  await readFile(RECOVERY_MIGRATION_URL, "utf8")
)
  .replace(/\s+/g, " ")
  .toLowerCase();

test("first claim returns claimed with the exact technical identifiers", async () => {
  const calls: unknown[] = [];

  const result = await claimAiMessageRunWithRpc(
    INPUT,
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          {
            attempt_count: 1,
            outcome: "claimed",
            run_id: RUN_ID,
            run_status: "processing",
          },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(result, {
    outcome: "claimed",
    runId: RUN_ID,
    status: "processing",
    attemptCount: 1,
  });
  assert.deepEqual(calls, [
    {
      functionName: "claim_ai_message_run",
      parameters: {
        p_conversation_id: CONVERSATION_ID,
        p_organization_id: ORGANIZATION_ID,
        p_trigger_message_id: MESSAGE_ID,
      },
    },
  ]);
});

test("same trigger cannot be represented as concurrently claimed twice", async () => {
  let callCount = 0;
  const rpc: AiMessageRunRpc = async () => {
    callCount += 1;
    return {
      data: [
        {
          attempt_count: 1,
          outcome: callCount === 1 ? "claimed" : "already_processing",
          run_id: RUN_ID,
          run_status: "processing",
        },
      ],
      error: null,
    };
  };

  const results = await Promise.all([
    claimAiMessageRunWithRpc(INPUT, rpc),
    claimAiMessageRunWithRpc(INPUT, rpc),
  ]);

  assert.equal(results.filter((result) => result.outcome === "claimed").length, 1);
  assert.equal(
    results.filter((result) => result.outcome === "already_processing").length,
    1,
  );
});

test("processing run returns already_processing", async () => {
  assert.deepEqual(
    await claimAiMessageRunWithRpc(INPUT, async () => ({
      data: [
        {
          attempt_count: 1,
          outcome: "already_processing",
          run_id: RUN_ID,
          run_status: "processing",
        },
      ],
      error: null,
    })),
    {
      outcome: "already_processing",
      runId: RUN_ID,
      status: "processing",
      attemptCount: 1,
    },
  );
});

test("terminal run returns already_terminal", async () => {
  assert.deepEqual(
    await claimAiMessageRunWithRpc(INPUT, async () => ({
      data: [
        {
          attempt_count: 1,
          outcome: "already_terminal",
          run_id: RUN_ID,
          run_status: "decided",
        },
      ],
      error: null,
    })),
    {
      outcome: "already_terminal",
      runId: RUN_ID,
      status: "decided",
      attemptCount: 1,
    },
  );
});

test("invalid tenant or message binding fails without database details", async () => {
  const sensitive = "cross-tenant message row and internal SQL";

  await assert.rejects(
    claimAiMessageRunWithRpc(INPUT, async () => ({
      data: null,
      error: { message: sensitive },
    })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, SAFE_REPOSITORY_ERROR);
      assert.equal(error.message.includes(sensitive), false);
      return true;
    },
  );
});

test("decided stores only the sanitized final decision", async () => {
  const calls: unknown[] = [];
  const resultWithExtraData = {
    outcome: "decided",
    decision: {
      action: "reply",
      text: "Здравствуйте!",
      rawOpenAiResponse: "must-not-persist",
    },
  } as unknown as AiInboundProcessingResult;

  const result = await storeAiMessageRunTerminalResultWithRpc(
    RUN_ID,
    resultWithExtraData,
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          { outcome: "stored", run_id: RUN_ID, run_status: "decided" },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(result, {
    outcome: "stored",
    runId: RUN_ID,
    status: "decided",
  });
  assert.deepEqual(calls, [
    {
      functionName: "complete_ai_message_run",
      parameters: {
        p_decision: { action: "reply", text: "Здравствуйте!" },
        p_failure_reason: null,
        p_run_id: RUN_ID,
        p_terminal_status: "decided",
      },
    },
  ]);
});

test("blocked stores only its safe reason", async () => {
  const calls: unknown[] = [];

  await storeAiMessageRunTerminalResultWithRpc(
    RUN_ID,
    { outcome: "blocked", reason: "ai_configuration_missing" },
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          { outcome: "stored", run_id: RUN_ID, run_status: "blocked" },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(calls, [
    {
      functionName: "complete_ai_message_run",
      parameters: {
        p_decision: null,
        p_failure_reason: "ai_configuration_missing",
        p_run_id: RUN_ID,
        p_terminal_status: "blocked",
      },
    },
  ]);
});

test("failed stores only its safe reason", async () => {
  const calls: unknown[] = [];

  await storeAiMessageRunTerminalResultWithRpc(
    RUN_ID,
    { outcome: "failed", reason: "provider_error" },
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          { outcome: "stored", run_id: RUN_ID, run_status: "failed" },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(calls, [
    {
      functionName: "complete_ai_message_run",
      parameters: {
        p_decision: null,
        p_failure_reason: "provider_error",
        p_run_id: RUN_ID,
        p_terminal_status: "failed",
      },
    },
  ]);
});

test("terminal result cannot be overwritten", async () => {
  assert.deepEqual(
    await storeAiMessageRunTerminalResultWithRpc(
      RUN_ID,
      { outcome: "failed", reason: "runtime_error" },
      async () => ({
        data: [
          {
            outcome: "already_terminal",
            run_id: RUN_ID,
            run_status: "decided",
          },
        ],
        error: null,
      }),
    ),
    {
      outcome: "already_terminal",
      runId: RUN_ID,
      status: "decided",
    },
  );
});

test("recovery returns only retryable technical identifiers and exhausted count", async () => {
  const calls: unknown[] = [];

  const result = await recoverStaleAiMessageRunsWithRpc(
    undefined,
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          {
            exhausted_count: 1,
            raw_openai_response: "must-not-return",
            retryable: [
              {
                attempt_count: 1,
                conversation_id: CONVERSATION_ID,
                customer_text: "must-not-return",
                organization_id: ORGANIZATION_ID,
                provider_id: "must-not-return",
                trigger_message_id: MESSAGE_ID,
              },
              {
                attempt_count: 2,
                conversation_id: "55555555-5555-4555-8555-555555555555",
                organization_id: "66666666-6666-4666-8666-666666666666",
                trigger_message_id: "77777777-7777-4777-8777-777777777777",
              },
            ],
          },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(calls, [
    {
      functionName: "recover_stale_ai_message_runs",
      parameters: { p_limit: 25 },
    },
  ]);
  assert.deepEqual(result, {
    retryable: [
      {
        organizationId: ORGANIZATION_ID,
        conversationId: CONVERSATION_ID,
        triggerMessageId: MESSAGE_ID,
        attemptCount: 1,
      },
      {
        organizationId: "66666666-6666-4666-8666-666666666666",
        conversationId: "55555555-5555-4555-8555-555555555555",
        triggerMessageId: "77777777-7777-4777-8777-777777777777",
        attemptCount: 2,
      },
    ],
    exhaustedCount: 1,
  });
  assert.equal(JSON.stringify(result).includes("must-not-return"), false);
});

test("recovery normalizes minimum, maximum, and fractional limits", async () => {
  const limits: number[] = [];
  const rpc: AiMessageRunRpc = async (_functionName, parameters) => {
    limits.push(parameters.p_limit as number);
    return {
      data: [{ exhausted_count: 0, retryable: [] }],
      error: null,
    };
  };

  await recoverStaleAiMessageRunsWithRpc(0, rpc);
  await recoverStaleAiMessageRunsWithRpc(100, rpc);
  await recoverStaleAiMessageRunsWithRpc(12.9, rpc);

  assert.deepEqual(limits, [1, 50, 12]);
});

test("recovery rejects invalid limits and malformed results before exposure", async () => {
  let rpcCalls = 0;

  await assert.rejects(
    recoverStaleAiMessageRunsWithRpc(Number.NaN, async () => {
      rpcCalls += 1;
      return { data: null, error: null };
    }),
    new RegExp(`^Error: ${SAFE_REPOSITORY_ERROR.replace(".", "\\.")}$`),
  );
  assert.equal(rpcCalls, 0);

  await assert.rejects(
    recoverStaleAiMessageRunsWithRpc(25, async () => ({
      data: [
        {
          exhausted_count: 0,
          retryable: [
            {
              attempt_count: 3,
              conversation_id: CONVERSATION_ID,
              organization_id: ORGANIZATION_ID,
              trigger_message_id: MESSAGE_ID,
            },
          ],
        },
      ],
      error: null,
    })),
    new RegExp(`^Error: ${SAFE_REPOSITORY_ERROR.replace(".", "\\.")}$`),
  );
});

test("recovery database failures never leak raw details", async () => {
  const sensitive = "raw SQL, customer text, and provider identifiers";

  for (const rpc of [
    async () => ({ data: null, error: { message: sensitive } }),
    async () => {
      throw new Error(sensitive);
    },
  ]) {
    await assert.rejects(
      recoverStaleAiMessageRunsWithRpc(25, rpc),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, SAFE_REPOSITORY_ERROR);
        assert.equal(error.message.includes(sensitive), false);
        return true;
      },
    );
  }
});

test("revised state constraint permits pending retries and preserves invariants", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /drop constraint ai_message_runs_processing_state/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /status = 'pending' and attempt_count >= 0 and processing_started_at is null/,
  );
  assert.doesNotMatch(
    RECOVERY_MIGRATION_SQL,
    /status = 'pending' and attempt_count = 0/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /status in \('processing', 'decided', 'blocked', 'failed'\) and attempt_count >= 1 and processing_started_at is not null/,
  );
  assert.doesNotMatch(
    RECOVERY_MIGRATION_SQL,
    /drop constraint ai_message_runs_terminal_payload/,
  );
});

test("recovery selects only processing rows stale for ten minutes", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /where run\.status = 'processing' and run\.processing_started_at <= operation_timestamp - interval '10 minutes'/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /where run\.status = 'processing'.*order by run\.processing_started_at, run\.id limit p_limit for update skip locked/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /create index ai_message_runs_processing_started_idx on public\.ai_message_runs \(processing_started_at, id\) where status = 'processing'/,
  );
});

test("stale attempts one and two return to pending without incrementing", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /status = case when stale_run\.attempt_count < 3 then 'pending' else 'failed' end/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /processing_started_at = case when stale_run\.attempt_count < 3 then null else run\.processing_started_at end/,
  );

  const updateAssignments = RECOVERY_MIGRATION_SQL.slice(
    RECOVERY_MIGRATION_SQL.indexOf("update public.ai_message_runs as run set"),
    RECOVERY_MIGRATION_SQL.indexOf("from stale_runs as stale_run"),
  );
  assert.equal(updateAssignments.includes("attempt_count ="), false);
});

test("stale attempt three is exhausted as an immutable failed result", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /failure_reason = case when stale_run\.attempt_count < 3 then null else 'recovery_attempts_exhausted' end/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /where run\.id = stale_run\.id and run\.status = 'processing' and run\.processing_started_at = stale_run\.processing_started_at/,
  );
  assert.doesNotMatch(
    RECOVERY_MIGRATION_SQL,
    /where run\.status in \('decided', 'blocked', 'failed'\)/,
  );
});

test("recovery RPC returns only the bounded safe recovery projection", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /if p_limit is null or p_limit < 1 or p_limit > 50 then/,
  );

  const projection = RECOVERY_MIGRATION_SQL.slice(
    RECOVERY_MIGRATION_SQL.indexOf("jsonb_build_object("),
    RECOVERY_MIGRATION_SQL.indexOf(") order by recovered_run"),
  );

  for (const field of [
    "'organization_id'",
    "'conversation_id'",
    "'trigger_message_id'",
    "'attempt_count'",
  ]) {
    assert.ok(projection.includes(field));
  }

  for (const forbidden of [
    "customer",
    "phone",
    "prompt",
    "openai",
    "provider",
    "credential",
    "decision",
    "failure_reason",
  ]) {
    assert.equal(projection.includes(forbidden), false);
  }
});

test("recovery RPC remains service-role-only without direct table grants", () => {
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /create function public\.recover_stale_ai_message_runs\( p_limit integer \).*security definer set search_path = ''/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /revoke all on function public\.recover_stale_ai_message_runs\(integer\) from public, anon, authenticated, service_role/,
  );
  assert.match(
    RECOVERY_MIGRATION_SQL,
    /grant execute on function public\.recover_stale_ai_message_runs\(integer\) to service_role/,
  );
  assert.doesNotMatch(
    RECOVERY_MIGRATION_SQL,
    /grant (select|insert|update|delete|truncate|references|trigger).*on public\.ai_message_runs/,
  );
  assert.doesNotMatch(RECOVERY_MIGRATION_SQL, /grant .* to anon/);
  assert.doesNotMatch(RECOVERY_MIGRATION_SQL, /grant .* to authenticated/);
});

test("schema defines the provider-neutral run ledger and exact status model", () => {
  assert.match(MIGRATION_SQL, /create table public\.ai_message_runs/);
  assert.match(
    MIGRATION_SQL,
    /status in \('pending', 'processing', 'decided', 'blocked', 'failed'\)/,
  );
  assert.match(
    MIGRATION_SQL,
    /constraint ai_message_runs_trigger_message_unique unique \(trigger_message_id\)/,
  );
  for (const reference of [
    "references public.organizations (id) on delete restrict",
    "references public.conversations (id) on delete restrict",
    "references public.messages (id) on delete restrict",
  ]) {
    assert.ok(MIGRATION_SQL.includes(reference));
  }
});

test("claim validates tenant binding and is atomic under concurrency", () => {
  assert.match(MIGRATION_SQL, /message\.id = p_trigger_message_id/);
  assert.match(MIGRATION_SQL, /message\.organization_id = p_organization_id/);
  assert.match(MIGRATION_SQL, /message\.conversation_id = p_conversation_id/);
  assert.match(MIGRATION_SQL, /message\.channel = conversation\.channel/);
  assert.match(MIGRATION_SQL, /message\.direction = 'inbound'/);
  assert.match(MIGRATION_SQL, /message\.message_type = 'text'/);
  assert.match(MIGRATION_SQL, /conversation\.organization_id = p_organization_id/);
  assert.match(
    MIGRATION_SQL,
    /on conflict \(trigger_message_id\) do nothing/,
  );
  assert.match(
    MIGRATION_SQL,
    /where run\.trigger_message_id = p_trigger_message_id and run\.status = 'pending'/,
  );
  assert.match(MIGRATION_SQL, /'already_processing'::text/);
  assert.match(MIGRATION_SQL, /'already_terminal'::text/);
});

test("terminal RPC enforces immutable terminal transitions and payload shape", () => {
  assert.match(
    MIGRATION_SQL,
    /where run\.id = p_run_id and run\.status = 'processing'/,
  );
  assert.match(
    MIGRATION_SQL,
    /status = 'decided' and decision is not null.*failure_reason is null/,
  );
  assert.match(
    MIGRATION_SQL,
    /status in \('blocked', 'failed'\) and decision is null and failure_reason is not null/,
  );
  assert.match(
    MIGRATION_SQL,
    /if stored_run_status in \('decided', 'blocked', 'failed'\) then return query select 'already_terminal'::text/,
  );
});

test("RLS and grants keep the ledger server-only with minimal RPC access", () => {
  assert.match(
    MIGRATION_SQL,
    /alter table public\.ai_message_runs enable row level security/,
  );
  assert.match(
    MIGRATION_SQL,
    /alter table public\.ai_message_runs force row level security/,
  );
  assert.match(
    MIGRATION_SQL,
    /revoke all on public\.ai_message_runs from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(
    MIGRATION_SQL,
    /grant (select|insert|update|delete).*on public\.ai_message_runs/,
  );
  assert.match(
    MIGRATION_SQL,
    /security definer set search_path = ''/,
  );
  assert.match(
    MIGRATION_SQL,
    /grant execute on function public\.claim_ai_message_run\(uuid, uuid, uuid\) to service_role/,
  );
  assert.match(
    MIGRATION_SQL,
    /grant execute on function public\.complete_ai_message_run\(uuid, text, jsonb, text\) to service_role/,
  );
  assert.doesNotMatch(MIGRATION_SQL, /grant .* to anon/);
  assert.doesNotMatch(MIGRATION_SQL, /grant .* to authenticated/);
});

test("schema introduces no raw prompt, OpenAI, webhook, or provider payload columns", () => {
  const tableDefinition = MIGRATION_SQL.slice(
    MIGRATION_SQL.indexOf("create table public.ai_message_runs"),
    MIGRATION_SQL.indexOf("create index ai_message_runs_organization_idx"),
  );

  for (const forbidden of [
    "raw_prompt",
    "prompt",
    "openai",
    "model_proposal",
    "webhook",
    "provider_response",
    "credentials",
  ]) {
    assert.equal(tableDefinition.includes(forbidden), false);
  }
});
