import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { AiInboundProcessingResult } from "./inbound-processing-core.ts";
import {
  claimAiMessageRunWithRpc,
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
