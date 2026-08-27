import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  recoverWhatsappOutboundDispatchWithDependencies,
  sendWhatsappConversationTextDurablyWithDependencies,
  WhatsappOutboundIndeterminateError,
  type WhatsappDurableOutboundConversationDependencies,
} from "./outbound-conversation-service-core.ts";
import {
  claimAiReplyWhatsappDispatchExecutionWithRpc,
  prepareAiReplyWhatsappDispatchWithRpc,
  prepareWhatsappOutboundDispatchWithRpc,
  quarantineStaleAiReplyWhatsappDispatchesWithRpc,
  recordWhatsappOutboundProviderAcceptanceWithRpc,
} from "./outbound-dispatch-repository-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const DISPATCH_ID = "44444444-4444-4444-8444-444444444444";
const MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const PROVIDER_MESSAGE_ID = "wamid.safe-provider-id";
const AI_MESSAGE_RUN_ID = "66666666-6666-4666-8666-666666666666";
const PHONE_NUMBER_ID = "123456789012345";
const RECIPIENT_WA_ID = "77001234567";
const SAFE_REPOSITORY_ERROR =
  "WhatsApp outbound dispatch repository operation failed.";
const AI_REPLY_BINDING_MIGRATION_URL = new URL(
  "../../../../supabase/migrations/20260827142909_bind_ai_reply_to_whatsapp_dispatch.sql",
  import.meta.url,
);
const AI_REPLY_EXECUTION_CLAIM_MIGRATION_URL = new URL(
  "../../../../supabase/migrations/20260827170826_claim_ai_reply_whatsapp_dispatch_execution.sql",
  import.meta.url,
);
const AI_REPLY_QUARANTINE_MIGRATION_URL = new URL(
  "../../../../supabase/migrations/20260827171938_quarantine_stale_ai_reply_whatsapp_dispatches.sql",
  import.meta.url,
);
const OUTBOUND_DISPATCH_REPOSITORY_URL = new URL(
  "./outbound-dispatch-repository.ts",
  import.meta.url,
);
const OUTBOUND_DISPATCH_REPOSITORY_CORE_URL = new URL(
  "./outbound-dispatch-repository-core.ts",
  import.meta.url,
);
const SAFE_INPUT = {
  conversationId: CONVERSATION_ID,
  organizationId: ORGANIZATION_ID,
  text: "Safe outbound text",
};

async function readAiReplyBindingMigration(): Promise<string> {
  return readFile(AI_REPLY_BINDING_MIGRATION_URL, "utf8");
}

function requireAiReplyPrepareFunction(migration: string): string {
  const prepareFunction = migration.match(
    /create function public\.prepare_ai_reply_whatsapp_dispatch\([\s\S]*?\n\$\$;/i,
  )?.[0];

  assert.ok(prepareFunction);
  return prepareFunction;
}

async function readAiReplyExecutionClaimMigration(): Promise<string> {
  return readFile(AI_REPLY_EXECUTION_CLAIM_MIGRATION_URL, "utf8");
}

function requireAiReplyExecutionClaimFunction(migration: string): string {
  const claimFunction = migration.match(
    /create function public\.claim_ai_reply_whatsapp_dispatch_execution\([\s\S]*?\n\$\$;/i,
  )?.[0];

  assert.ok(claimFunction);
  return claimFunction;
}

async function readAiReplyQuarantineMigration(): Promise<string> {
  return readFile(AI_REPLY_QUARANTINE_MIGRATION_URL, "utf8");
}

function requireAiReplyQuarantineFunction(migration: string): string {
  const quarantineFunction = migration.match(
    /create function public\.quarantine_stale_ai_reply_whatsapp_dispatches\([\s\S]*?\n\$\$;/i,
  )?.[0];

  assert.ok(quarantineFunction);
  return quarantineFunction;
}

function createDependencies(
  events: string[],
  overrides: Partial<WhatsappDurableOutboundConversationDependencies> = {},
): WhatsappDurableOutboundConversationDependencies {
  return {
    finalizeDispatch: async () => {
      events.push("finalize");
      return { messageId: MESSAGE_ID, outcome: "accepted" };
    },
    lookupConversation: async () => {
      events.push("lookup");
      return {
        data: [
          {
            channel: "whatsapp",
            connection: {
              id: CONNECTION_ID,
              organization_id: ORGANIZATION_ID,
              phone_number_id: "123456789",
              status: "active",
            },
            external_participant_id: "77001234567",
            id: CONVERSATION_ID,
            organization_id: ORGANIZATION_ID,
          },
        ],
        error: null,
      };
    },
    markDispatching: async () => {
      events.push("dispatching");
      return { dispatchId: DISPATCH_ID, state: "dispatching" };
    },
    markIndeterminate: async () => {
      events.push("indeterminate");
      return { dispatchId: DISPATCH_ID, state: "indeterminate" };
    },
    prepareDispatch: async () => {
      events.push("prepare");
      return { dispatchId: DISPATCH_ID };
    },
    recordProviderAcceptance: async () => {
      events.push("provider_accepted");
      return { dispatchId: DISPATCH_ID, state: "provider_accepted" };
    },
    sendTextMessage: async () => {
      events.push("meta");
      return { providerMessageId: PROVIDER_MESSAGE_ID };
    },
    waitBeforeRetry: async () => undefined,
    ...overrides,
  };
}

test("durable dispatch exists and is dispatching before Meta, then finalizes once", async () => {
  const events: string[] = [];
  let resolvedSenderInput: unknown;

  const result = await sendWhatsappConversationTextDurablyWithDependencies(
    SAFE_INPUT,
    createDependencies(events, {
      sendTextMessage: async (input) => {
        events.push("meta");
        resolvedSenderInput = input;
        return { providerMessageId: PROVIDER_MESSAGE_ID };
      },
    }),
  );

  assert.deepEqual(events, [
    "lookup",
    "prepare",
    "dispatching",
    "meta",
    "provider_accepted",
    "finalize",
  ]);
  assert.deepEqual(resolvedSenderInput, {
    phoneNumberId: "123456789",
    recipientWaId: "77001234567",
    text: SAFE_INPUT.text,
  });
  assert.deepEqual(result, {
    messageId: MESSAGE_ID,
    outcome: "persisted",
    persistenceOutcome: "accepted",
    providerMessageId: PROVIDER_MESSAGE_ID,
  });
});

test("preparation failure prevents Meta", async () => {
  const events: string[] = [];
  const secret = "database-secret-detail";

  await assert.rejects(
    sendWhatsappConversationTextDurablyWithDependencies(
      SAFE_INPUT,
      createDependencies(events, {
        prepareDispatch: async () => {
          events.push("prepare");
          throw new Error(secret);
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  assert.deepEqual(events, ["lookup", "prepare"]);
});

test("Meta uncertainty marks dispatch indeterminate and is never retried", async () => {
  const events: string[] = [];
  let sendCount = 0;

  await assert.rejects(
    sendWhatsappConversationTextDurablyWithDependencies(
      SAFE_INPUT,
      createDependencies(events, {
        sendTextMessage: async () => {
          events.push("meta");
          sendCount += 1;
          throw new Error("raw Meta secret detail");
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof WhatsappOutboundIndeterminateError);
      assert.equal(error.code, "WHATSAPP_OUTBOUND_INDETERMINATE");
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );

  assert.equal(sendCount, 1);
  assert.equal(events.at(-1), "indeterminate");
  assert.equal(events.includes("finalize"), false);
});

test("provider acceptance retries only the same database operation and provider id", async () => {
  const events: string[] = [];
  const providerIds: string[] = [];
  let acceptanceAttempt = 0;
  let sendCount = 0;

  const result = await sendWhatsappConversationTextDurablyWithDependencies(
    SAFE_INPUT,
    createDependencies(events, {
      recordProviderAcceptance: async (input) => {
        events.push("provider_accepted");
        providerIds.push(input.providerMessageId);
        acceptanceAttempt += 1;
        if (acceptanceAttempt < 3) throw new Error("temporary DB detail");
        return { dispatchId: DISPATCH_ID, state: "provider_accepted" };
      },
      sendTextMessage: async () => {
        events.push("meta");
        sendCount += 1;
        return { providerMessageId: PROVIDER_MESSAGE_ID };
      },
    }),
  );

  assert.equal(result.outcome, "persisted");
  assert.equal(sendCount, 1);
  assert.deepEqual(providerIds, [
    PROVIDER_MESSAGE_ID,
    PROVIDER_MESSAGE_ID,
    PROVIDER_MESSAGE_ID,
  ]);
});

test("finalization exhaustion returns recovery_required without resending", async () => {
  const events: string[] = [];
  let finalizeCount = 0;
  let sendCount = 0;

  const result = await sendWhatsappConversationTextDurablyWithDependencies(
    SAFE_INPUT,
    createDependencies(events, {
      finalizeDispatch: async () => {
        events.push("finalize");
        finalizeCount += 1;
        throw new Error("private database failure");
      },
      sendTextMessage: async () => {
        events.push("meta");
        sendCount += 1;
        return { providerMessageId: PROVIDER_MESSAGE_ID };
      },
    }),
  );

  assert.deepEqual(result, {
    dispatchId: DISPATCH_ID,
    outcome: "recovery_required",
    providerMessageId: PROVIDER_MESSAGE_ID,
  });
  assert.equal(sendCount, 1);
  assert.equal(finalizeCount, 3);
});

test("transient finalization failure retries database only and then persists", async () => {
  let finalizeCount = 0;
  let sendCount = 0;

  const result = await sendWhatsappConversationTextDurablyWithDependencies(
    SAFE_INPUT,
    createDependencies([], {
      finalizeDispatch: async () => {
        finalizeCount += 1;
        if (finalizeCount < 3) throw new Error("temporary database detail");
        return { messageId: MESSAGE_ID, outcome: "accepted" };
      },
      sendTextMessage: async () => {
        sendCount += 1;
        return { providerMessageId: PROVIDER_MESSAGE_ID };
      },
    }),
  );

  assert.equal(result.outcome, "persisted");
  assert.equal(finalizeCount, 3);
  assert.equal(sendCount, 1);
});

test("duplicate finalization is a successful persisted result", async () => {
  const result = await sendWhatsappConversationTextDurablyWithDependencies(
    SAFE_INPUT,
    createDependencies([], {
      finalizeDispatch: async () => ({
        messageId: MESSAGE_ID,
        outcome: "duplicate",
      }),
    }),
  );

  assert.equal(result.outcome, "persisted");
  if (result.outcome === "persisted") {
    assert.equal(result.persistenceOutcome, "duplicate");
  }
});

test("provider_accepted recovery only finalizes and has no sender dependency", async () => {
  const events: string[] = [];

  const result = await recoverWhatsappOutboundDispatchWithDependencies(
    {
      dispatchId: DISPATCH_ID,
      organizationId: ORGANIZATION_ID,
      providerMessageId: PROVIDER_MESSAGE_ID,
    },
    {
      finalizeDispatch: async () => {
        events.push("finalize");
        return { messageId: MESSAGE_ID, outcome: "duplicate" };
      },
      getRecoveryState: async () => ({
        dispatchId: DISPATCH_ID,
        providerMessageId: PROVIDER_MESSAGE_ID,
        state: "provider_accepted",
      }),
      recordProviderAcceptance: async () => {
        events.push("provider_accepted");
        return { dispatchId: DISPATCH_ID, state: "provider_accepted" };
      },
    },
  );

  assert.deepEqual(events, ["finalize"]);
  assert.deepEqual(result, {
    messageId: MESSAGE_ID,
    outcome: "persisted",
    persistenceOutcome: "duplicate",
    providerMessageId: PROVIDER_MESSAGE_ID,
  });
});

test("dispatching recovery records the known provider id and then finalizes", async () => {
  const events: string[] = [];

  const result = await recoverWhatsappOutboundDispatchWithDependencies(
    {
      dispatchId: DISPATCH_ID,
      organizationId: ORGANIZATION_ID,
      providerMessageId: PROVIDER_MESSAGE_ID,
    },
    {
      finalizeDispatch: async () => {
        events.push("finalize");
        return { messageId: MESSAGE_ID, outcome: "accepted" };
      },
      getRecoveryState: async () => ({
        dispatchId: DISPATCH_ID,
        providerMessageId: null,
        state: "dispatching",
      }),
      recordProviderAcceptance: async (input) => {
        events.push(`record:${input.providerMessageId}`);
        return { dispatchId: DISPATCH_ID, state: "provider_accepted" };
      },
    },
  );

  assert.deepEqual(events, [`record:${PROVIDER_MESSAGE_ID}`, "finalize"]);
  assert.equal(result.outcome, "persisted");
});

test("repository rejects invalid identity before RPC and hides database details", async () => {
  let rpcCalls = 0;
  const secret = "provider-or-database-secret";

  assert.throws(() =>
    prepareWhatsappOutboundDispatchWithRpc(
      {
        connectionId: "invalid",
        conversationId: CONVERSATION_ID,
        organizationId: ORGANIZATION_ID,
        textContent: SAFE_INPUT.text,
      },
      async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    ),
  );
  assert.equal(rpcCalls, 0);

  await assert.rejects(
    recordWhatsappOutboundProviderAcceptanceWithRpc(
      {
        dispatchId: DISPATCH_ID,
        organizationId: ORGANIZATION_ID,
        providerMessageId: PROVIDER_MESSAGE_ID,
      },
      async () => {
        throw new Error(secret);
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("migration defines tenant-safe journal, transitions, recovery and grants", async () => {
  const sql = await readFile(
    new URL(
      "../../../../supabase/migrations/20260822205023_whatsapp_outbound_dispatch_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /create table public\.whatsapp_outbound_dispatches/i);
  assert.match(sql, /state in \([\s\S]*'prepared'[\s\S]*'dispatching'[\s\S]*'provider_accepted'[\s\S]*'persisted'[\s\S]*'indeterminate'/i);
  assert.match(sql, /provider_message_id[\s\S]*create unique index whatsapp_outbound_dispatches_provider_message_id_key/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.whatsapp_outbound_dispatches[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public\.whatsapp_outbound_dispatches[\s\S]*to service_role/i);

  for (const functionName of [
    "prepare_whatsapp_outbound_dispatch",
    "get_whatsapp_outbound_dispatch_recovery_state",
    "mark_whatsapp_outbound_dispatching",
    "record_whatsapp_outbound_provider_acceptance",
    "mark_whatsapp_outbound_dispatch_indeterminate",
    "finalize_whatsapp_outbound_dispatch",
  ]) {
    assert.match(sql, new RegExp(`create function public\\.${functionName}`, "i"));
  }

  assert.match(sql, /connection\.status = 'active'/i);
  assert.match(sql, /existing_text_content is distinct from target_text_content/i);
  assert.match(sql, /same dispatch cannot later|provider message identity conflict/i);
  assert.match(sql, /state = 'persisted'[\s\S]*persisted_at = coalesce/i);
  assert.match(sql, /create or replace function public\.apply_whatsapp_outbound_delivery_status/i);
  assert.match(sql, /dispatch\.organization_id = p_organization_id[\s\S]*dispatch\.connection_id = p_connection_id[\s\S]*dispatch\.provider_message_id = p_provider_message_id/i);
  assert.match(sql, /recovery_dispatch_state = 'provider_accepted'[\s\S]*finalize_whatsapp_outbound_dispatch/i);
  assert.doesNotMatch(sql, /recipient_wa_id|phone_number_id|waba_id|access_token|raw_response/i);
});

test("AI reply binding adds a nullable restrictive FK with one-dispatch uniqueness", async () => {
  const migration = await readAiReplyBindingMigration();
  const existingOutboundMigration = await readFile(
    new URL(
      "../../../../supabase/migrations/20260822205023_whatsapp_outbound_dispatch_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const columnDefinition = migration.match(
    /add column source_ai_message_run_id uuid[\s\S]*?on delete restrict;/i,
  )?.[0];

  assert.ok(columnDefinition);
  assert.match(
    columnDefinition,
    /references public\.ai_message_runs \(id\) on delete restrict/i,
  );
  assert.doesNotMatch(columnDefinition, /not null/i);
  assert.match(
    migration,
    /constraint whatsapp_outbound_dispatches_source_ai_message_run_unique[\s\S]*unique \(source_ai_message_run_id\)/i,
  );
  assert.doesNotMatch(
    migration,
    /check \(source_ai_message_run_id is not null\)/i,
  );
  assert.match(
    existingOutboundMigration,
    /insert into public\.whatsapp_outbound_dispatches \(\s*organization_id,\s*conversation_id,\s*connection_id,\s*text_content\s*\)/i,
  );
});

test("AI reply prepare derives validated text and rejects every non-reply source", async () => {
  const prepareFunction = requireAiReplyPrepareFunction(
    await readAiReplyBindingMigration(),
  );

  assert.match(
    prepareFunction,
    /public\.prepare_ai_reply_whatsapp_dispatch\(\s*p_organization_id uuid,\s*p_ai_message_run_id uuid\s*\)/i,
  );
  assert.doesNotMatch(prepareFunction, /p_text|p_reply/i);
  assert.match(prepareFunction, /run\.id = p_ai_message_run_id/i);
  assert.match(prepareFunction, /run\.organization_id = p_organization_id/i);
  assert.match(prepareFunction, /run\.status = 'decided'/i);
  assert.match(prepareFunction, /jsonb_typeof\(run\.decision\) = 'object'/i);
  assert.match(prepareFunction, /run\.decision ->> 'action' = 'reply'/i);
  assert.match(
    prepareFunction,
    /run\.decision - array\['action', 'text'\] = '\{\}'::jsonb/i,
  );
  assert.match(
    prepareFunction,
    /jsonb_typeof\(run\.decision -> 'text'\) = 'string'/i,
  );
  assert.match(
    prepareFunction,
    /char_length\(run\.decision ->> 'text'\) between 1 and 2000/i,
  );
  assert.match(
    prepareFunction,
    /run\.decision ->> 'text' = btrim\(run\.decision ->> 'text'\)/i,
  );

  for (const rejectedSource of [
    "pending",
    "processing",
    "blocked",
    "failed",
    "booking_action_required",
    "handoff",
    "no_safe_answer",
  ]) {
    assert.equal(prepareFunction.includes(`= '${rejectedSource}'`), false);
  }
});

test("AI reply prepare validates tenant, WhatsApp conversation, and active connection", async () => {
  const prepareFunction = requireAiReplyPrepareFunction(
    await readAiReplyBindingMigration(),
  );

  assert.match(
    prepareFunction,
    /conversation\.id = run\.conversation_id/i,
  );
  assert.match(
    prepareFunction,
    /conversation\.organization_id = p_organization_id/i,
  );
  assert.match(prepareFunction, /conversation\.channel = 'whatsapp'/i);
  assert.match(
    prepareFunction,
    /connection\.id = conversation\.channel_connection_id/i,
  );
  assert.match(
    prepareFunction,
    /connection\.organization_id = p_organization_id/i,
  );
  assert.match(prepareFunction, /connection\.status = 'active'/i);
  assert.match(
    prepareFunction,
    /for update of run\s+for share of conversation, connection/i,
  );
});

test("first and concurrent prepare calls create at most one immutable dispatch", async () => {
  const migration = await readAiReplyBindingMigration();
  const prepareFunction = requireAiReplyPrepareFunction(migration);

  assert.match(
    prepareFunction,
    /insert into public\.whatsapp_outbound_dispatches[\s\S]*source_ai_message_run_id/i,
  );
  assert.match(
    prepareFunction,
    /source_reply_text,\s*'prepared',\s*p_ai_message_run_id/i,
  );
  assert.match(
    prepareFunction,
    /on conflict \(source_ai_message_run_id\) do nothing/i,
  );
  assert.match(
    prepareFunction,
    /where dispatch\.source_ai_message_run_id = p_ai_message_run_id[\s\S]*dispatch\.organization_id = p_organization_id/i,
  );
  assert.doesNotMatch(
    prepareFunction,
    /on conflict[\s\S]*do update/i,
  );
  assert.doesNotMatch(
    prepareFunction,
    /update public\.whatsapp_outbound_dispatches/i,
  );
  assert.match(
    migration,
    /unique \(source_ai_message_run_id\)/i,
  );
});

test("AI reply prepare returns only dispatch identity and existing state", async () => {
  const prepareFunction = requireAiReplyPrepareFunction(
    await readAiReplyBindingMigration(),
  );
  const returnProjection = prepareFunction.match(
    /returns table \([\s\S]*?\)\s*language plpgsql/i,
  )?.[0];

  assert.ok(returnProjection);
  assert.match(returnProjection, /dispatch_id uuid/i);
  assert.match(returnProjection, /state text/i);

  for (const forbidden of [
    "text_content",
    "decision",
    "provider_message_id",
    "organization_id",
    "conversation_id",
    "connection_id",
    "customer",
    "prompt",
  ]) {
    assert.equal(returnProjection.toLowerCase().includes(forbidden), false);
  }
  assert.match(
    prepareFunction,
    /select dispatch\.id, dispatch\.state[\s\S]*return query\s*select prepared_dispatch_id, prepared_dispatch_state/i,
  );
});

test("AI reply prepare RPC is SECURITY DEFINER and service-role-only", async () => {
  const migration = await readAiReplyBindingMigration();
  const prepareFunction = requireAiReplyPrepareFunction(migration);

  assert.match(prepareFunction, /security definer/i);
  assert.match(prepareFunction, /set search_path = ''/i);
  assert.match(
    migration,
    /revoke all\s+on function public\.prepare_ai_reply_whatsapp_dispatch\(uuid, uuid\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant execute\s+on function public\.prepare_ai_reply_whatsapp_dispatch\(uuid, uuid\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|truncate|references|trigger)[\s\S]*on (table )?public\.whatsapp_outbound_dispatches/i,
  );
  assert.doesNotMatch(migration, /grant .* to anon/i);
  assert.doesNotMatch(migration, /grant .* to authenticated/i);
  assert.doesNotMatch(migration, /disable row level security/i);
});

test("AI reply repository sends no caller text and returns only a safe result", async () => {
  const calls: unknown[] = [];
  const inputWithAlternateText = {
    aiMessageRunId: AI_MESSAGE_RUN_ID,
    organizationId: ORGANIZATION_ID,
    textContent: "caller must not control this",
  };

  const result = await prepareAiReplyWhatsappDispatchWithRpc(
    inputWithAlternateText,
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          {
            dispatch_id: DISPATCH_ID,
            provider_message_id: "must-not-return",
            state: "provider_accepted",
            text_content: "must-not-return",
          },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(calls, [
    {
      functionName: "prepare_ai_reply_whatsapp_dispatch",
      parameters: {
        p_ai_message_run_id: AI_MESSAGE_RUN_ID,
        p_organization_id: ORGANIZATION_ID,
      },
    },
  ]);
  assert.deepEqual(result, {
    dispatchId: DISPATCH_ID,
    state: "provider_accepted",
  });
  assert.equal(JSON.stringify(result).includes("must-not-return"), false);
});

test("AI reply repository validates UUID/state and hides raw database errors", async () => {
  let rpcCalls = 0;

  assert.throws(
    () =>
      prepareAiReplyWhatsappDispatchWithRpc(
        {
          aiMessageRunId: "invalid",
          organizationId: ORGANIZATION_ID,
        },
        async () => {
          rpcCalls += 1;
          return { data: null, error: null };
        },
      ),
    new RegExp(SAFE_REPOSITORY_ERROR.replaceAll(".", "\\.")),
  );
  assert.equal(rpcCalls, 0);

  await assert.rejects(
    prepareAiReplyWhatsappDispatchWithRpc(
      {
        aiMessageRunId: AI_MESSAGE_RUN_ID,
        organizationId: ORGANIZATION_ID,
      },
      async () => ({
        data: [{ dispatch_id: DISPATCH_ID, state: "unknown" }],
        error: null,
      }),
    ),
    new RegExp(SAFE_REPOSITORY_ERROR.replaceAll(".", "\\.")),
  );

  const sensitive = "raw Supabase customer and database detail";
  for (const rpc of [
    async () => ({ data: null, error: { message: sensitive } }),
    async () => {
      throw new Error(sensitive);
    },
  ]) {
    await assert.rejects(
      prepareAiReplyWhatsappDispatchWithRpc(
        {
          aiMessageRunId: AI_MESSAGE_RUN_ID,
          organizationId: ORGANIZATION_ID,
        },
        rpc,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, SAFE_REPOSITORY_ERROR);
        assert.equal(error.message.includes(sensitive), false);
        return true;
      },
    );
  }
});

test("AI reply repository adds no sender, Meta, Graph, or CRM dependency", async () => {
  const source = `${await readFile(OUTBOUND_DISPATCH_REPOSITORY_URL, "utf8")} ${await readFile(OUTBOUND_DISPATCH_REPOSITORY_CORE_URL, "utf8")}`
    .replace(/\s+/g, " ")
    .toLowerCase();

  for (const forbidden of [
    "sendwhatsappconversationtext",
    "sendtextmessage",
    "graph.facebook",
    "fetch(",
    "crm",
    "booking provider",
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
  assert.doesNotMatch(source, /import [^;]*meta/);
});

test("AI execution claim validates the bound decided reply and send routing", async () => {
  const claimFunction = requireAiReplyExecutionClaimFunction(
    await readAiReplyExecutionClaimMigration(),
  );

  assert.match(
    claimFunction,
    /public\.claim_ai_reply_whatsapp_dispatch_execution\(\s*p_organization_id uuid,\s*p_ai_message_run_id uuid\s*\)/i,
  );
  assert.doesNotMatch(claimFunction, /p_text|p_phone|p_recipient/i);
  assert.match(
    claimFunction,
    /dispatch\.source_ai_message_run_id = p_ai_message_run_id/i,
  );
  assert.match(
    claimFunction,
    /dispatch\.organization_id = p_organization_id/i,
  );
  assert.match(claimFunction, /run\.id = p_ai_message_run_id/i);
  assert.match(claimFunction, /run\.organization_id = p_organization_id/i);
  assert.match(claimFunction, /run\.status = 'decided'/i);
  assert.match(claimFunction, /jsonb_typeof\(run\.decision\) = 'object'/i);
  assert.match(claimFunction, /run\.decision ->> 'action' = 'reply'/i);
  assert.match(
    claimFunction,
    /conversation\.id = dispatch\.conversation_id[\s\S]*conversation\.organization_id = p_organization_id[\s\S]*conversation\.channel = 'whatsapp'/i,
  );
  assert.match(
    claimFunction,
    /connection\.id = dispatch\.connection_id[\s\S]*connection\.organization_id = p_organization_id[\s\S]*connection\.id = conversation\.channel_connection_id[\s\S]*connection\.status = 'active'/i,
  );
  assert.match(
    claimFunction,
    /conversation\.external_participant_id is not null/i,
  );
  assert.match(claimFunction, /connection\.phone_number_id is not null/i);
});

test("AI execution claim has exactly one prepared-to-dispatching winner", async () => {
  const claimFunction = requireAiReplyExecutionClaimFunction(
    await readAiReplyExecutionClaimMigration(),
  );

  assert.match(
    claimFunction,
    /for update of dispatch\s+for share of run, conversation, connection/i,
  );
  assert.match(
    claimFunction,
    /if bound_dispatch_state = 'prepared' then[\s\S]*update public\.whatsapp_outbound_dispatches as dispatch[\s\S]*state = 'dispatching'[\s\S]*where dispatch\.id = bound_dispatch_id\s+and dispatch\.state = 'prepared'/i,
  );
  assert.match(
    claimFunction,
    /claim_outcome := 'claimed'/i,
  );
  assert.match(
    claimFunction,
    /bound_dispatch_state = 'dispatching'[\s\S]*claim_outcome := 'already_dispatching'/i,
  );
  assert.doesNotMatch(claimFunction, /set\s+state = 'prepared'/i);
});

test("AI execution claim preserves every existing non-prepared state", async () => {
  const claimFunction = requireAiReplyExecutionClaimFunction(
    await readAiReplyExecutionClaimMigration(),
  );

  assert.match(
    claimFunction,
    /bound_dispatch_state in \(\s*'provider_accepted',\s*'persisted',\s*'indeterminate'\s*\)[\s\S]*claim_outcome := bound_dispatch_state/i,
  );

  const updateStatement = claimFunction.match(
    /update public\.whatsapp_outbound_dispatches as dispatch[\s\S]*?and dispatch\.state = 'prepared';/i,
  )?.[0];

  assert.ok(updateStatement);
  assert.match(updateStatement, /state = 'dispatching'/i);
  assert.match(updateStatement, /updated_at = clock_timestamp\(\)/i);
  for (const immutableField of [
    "text_content",
    "source_ai_message_run_id",
    "organization_id",
    "conversation_id",
    "connection_id",
    "provider_message_id",
    "provider_accepted_at",
  ]) {
    assert.equal(updateStatement.includes(`${immutableField} =`), false);
  }
});

test("only the one claim winner receives bound routing and dispatch text", async () => {
  const claimFunction = requireAiReplyExecutionClaimFunction(
    await readAiReplyExecutionClaimMigration(),
  );

  assert.match(
    claimFunction,
    /connection\.phone_number_id,\s*conversation\.external_participant_id,\s*dispatch\.text_content/i,
  );
  assert.doesNotMatch(claimFunction, /run\.decision ->> 'text'/i);
  assert.match(
    claimFunction,
    /case when claim_outcome = 'claimed' then bound_phone_number_id else null end/i,
  );
  assert.match(
    claimFunction,
    /case when claim_outcome = 'claimed' then bound_recipient_wa_id else null end/i,
  );
  assert.match(
    claimFunction,
    /case when claim_outcome = 'claimed' then bound_text else null end/i,
  );

  const returnProjection = claimFunction.match(
    /returns table \([\s\S]*?\)\s*language plpgsql/i,
  )?.[0];
  assert.ok(returnProjection);
  for (const field of [
    "outcome text",
    "dispatch_id uuid",
    "phone_number_id text",
    "recipient_wa_id text",
    "text text",
  ]) {
    assert.ok(returnProjection.toLowerCase().includes(field));
  }
  for (const forbidden of [
    "access_token",
    "waba",
    "provider_message_id",
    "decision",
    "prompt",
    "webhook",
  ]) {
    assert.equal(returnProjection.toLowerCase().includes(forbidden), false);
  }
});

test("AI execution claim RPC remains service-role-only without table grants", async () => {
  const migration = await readAiReplyExecutionClaimMigration();
  const claimFunction = requireAiReplyExecutionClaimFunction(migration);

  assert.match(claimFunction, /security definer/i);
  assert.match(claimFunction, /set search_path = ''/i);
  assert.match(
    migration,
    /revoke all\s+on function public\.claim_ai_reply_whatsapp_dispatch_execution\(uuid, uuid\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant execute\s+on function public\.claim_ai_reply_whatsapp_dispatch_execution\(uuid, uuid\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|truncate|references|trigger)[\s\S]*on (table )?public\.whatsapp_outbound_dispatches/i,
  );
  assert.doesNotMatch(migration, /grant .* to anon/i);
  assert.doesNotMatch(migration, /grant .* to authenticated/i);
  assert.doesNotMatch(migration, /disable row level security/i);
});

test("AI execution repository returns claimed context without caller-controlled text", async () => {
  const calls: unknown[] = [];
  const inputWithAlternateText = {
    aiMessageRunId: AI_MESSAGE_RUN_ID,
    organizationId: ORGANIZATION_ID,
    text: "caller must not control this",
  };

  const result = await claimAiReplyWhatsappDispatchExecutionWithRpc(
    inputWithAlternateText,
    async (functionName, parameters) => {
      calls.push({ functionName, parameters });
      return {
        data: [
          {
            dispatch_id: DISPATCH_ID,
            outcome: "claimed",
            phone_number_id: PHONE_NUMBER_ID,
            provider_message_id: "must-not-return",
            recipient_wa_id: RECIPIENT_WA_ID,
            text: "Stored immutable AI reply",
          },
        ],
        error: null,
      };
    },
  );

  assert.deepEqual(calls, [
    {
      functionName: "claim_ai_reply_whatsapp_dispatch_execution",
      parameters: {
        p_ai_message_run_id: AI_MESSAGE_RUN_ID,
        p_organization_id: ORGANIZATION_ID,
      },
    },
  ]);
  assert.deepEqual(result, {
    outcome: "claimed",
    dispatchId: DISPATCH_ID,
    phoneNumberId: PHONE_NUMBER_ID,
    recipientWaId: RECIPIENT_WA_ID,
    text: "Stored immutable AI reply",
  });
  assert.equal(JSON.stringify(result).includes("must-not-return"), false);
});

test("AI execution repository maps every state-only outcome without send context", async () => {
  for (const outcome of [
    "already_dispatching",
    "provider_accepted",
    "persisted",
    "indeterminate",
  ] as const) {
    const result = await claimAiReplyWhatsappDispatchExecutionWithRpc(
      {
        aiMessageRunId: AI_MESSAGE_RUN_ID,
        organizationId: ORGANIZATION_ID,
      },
      async () => ({
        data: [
          {
            dispatch_id: DISPATCH_ID,
            outcome,
            phone_number_id: null,
            recipient_wa_id: null,
            text: null,
          },
        ],
        error: null,
      }),
    );

    assert.deepEqual(result, { outcome, dispatchId: DISPATCH_ID });
  }
});

test("AI execution repository rejects malformed or unsafe claim results", async () => {
  const safeInput = {
    aiMessageRunId: AI_MESSAGE_RUN_ID,
    organizationId: ORGANIZATION_ID,
  };
  const malformedRows = [
    {
      dispatch_id: DISPATCH_ID,
      outcome: "already_dispatching",
      phone_number_id: PHONE_NUMBER_ID,
      recipient_wa_id: null,
      text: null,
    },
    {
      dispatch_id: DISPATCH_ID,
      outcome: "claimed",
      phone_number_id: "not-decimal",
      recipient_wa_id: RECIPIENT_WA_ID,
      text: "Safe text",
    },
    {
      dispatch_id: DISPATCH_ID,
      outcome: "claimed",
      phone_number_id: PHONE_NUMBER_ID,
      recipient_wa_id: RECIPIENT_WA_ID,
      text: " ",
    },
    {
      dispatch_id: DISPATCH_ID,
      outcome: "unknown",
      phone_number_id: null,
      recipient_wa_id: null,
      text: null,
    },
  ];

  for (const row of malformedRows) {
    await assert.rejects(
      claimAiReplyWhatsappDispatchExecutionWithRpc(
        safeInput,
        async () => ({ data: [row], error: null }),
      ),
      new RegExp(SAFE_REPOSITORY_ERROR.replaceAll(".", "\\.")),
    );
  }

  let rpcCalls = 0;
  assert.throws(() =>
    claimAiReplyWhatsappDispatchExecutionWithRpc(
      { aiMessageRunId: "invalid", organizationId: ORGANIZATION_ID },
      async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    ),
  );
  assert.equal(rpcCalls, 0);
});

test("AI execution repository hides raw database failures", async () => {
  const sensitive = "raw database, customer, and provider detail";

  for (const rpc of [
    async () => ({ data: null, error: { message: sensitive } }),
    async () => {
      throw new Error(sensitive);
    },
  ]) {
    await assert.rejects(
      claimAiReplyWhatsappDispatchExecutionWithRpc(
        {
          aiMessageRunId: AI_MESSAGE_RUN_ID,
          organizationId: ORGANIZATION_ID,
        },
        rpc,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, SAFE_REPOSITORY_ERROR);
        assert.equal(error.message.includes(sensitive), false);
        return true;
      },
    );
  }
});

test("stale quarantine selects only old AI-bound dispatching rows", async () => {
  const quarantineFunction = requireAiReplyQuarantineFunction(
    await readAiReplyQuarantineMigration(),
  );

  assert.match(
    quarantineFunction,
    /dispatch\.source_ai_message_run_id is not null\s+and dispatch\.state = 'dispatching'\s+and dispatch\.updated_at <= operation_timestamp - interval '10 minutes'/i,
  );
  assert.doesNotMatch(
    quarantineFunction,
    /source_ai_message_run_id is null/i,
  );
  for (const untouchedState of [
    "prepared",
    "provider_accepted",
    "persisted",
  ]) {
    assert.equal(quarantineFunction.includes(`'${untouchedState}'`), false);
  }
  assert.doesNotMatch(
    quarantineFunction,
    /where dispatch\.state = 'indeterminate'/i,
  );
  assert.doesNotMatch(
    quarantineFunction,
    /updated_at > operation_timestamp - interval '10 minutes'/i,
  );
});

test("stale quarantine is bounded, deterministic, and concurrency-safe", async () => {
  const quarantineFunction = requireAiReplyQuarantineFunction(
    await readAiReplyQuarantineMigration(),
  );

  assert.match(
    quarantineFunction,
    /if p_limit is null or p_limit < 1 or p_limit > 50 then/i,
  );
  assert.match(
    quarantineFunction,
    /order by dispatch\.updated_at, dispatch\.id\s+limit p_limit\s+for update skip locked/i,
  );
  assert.match(
    quarantineFunction,
    /with stale_dispatches as materialized/i,
  );
  assert.match(
    quarantineFunction,
    /from stale_dispatches as stale_dispatch\s+where dispatch\.id = stale_dispatch\.id/i,
  );
});

test("stale quarantine changes only state and updated_at", async () => {
  const quarantineFunction = requireAiReplyQuarantineFunction(
    await readAiReplyQuarantineMigration(),
  );
  const updateStatement = quarantineFunction.match(
    /update public\.whatsapp_outbound_dispatches as dispatch[\s\S]*?returning 1/i,
  )?.[0];

  assert.ok(updateStatement);
  assert.match(updateStatement, /state = 'indeterminate'/i);
  assert.match(updateStatement, /updated_at = operation_timestamp/i);
  assert.match(updateStatement, /dispatch\.state = 'dispatching'/i);
  assert.doesNotMatch(updateStatement, /state = 'prepared'/i);

  for (const immutableField of [
    "provider_message_id",
    "provider_accepted_at",
    "persisted_at",
    "text_content",
    "organization_id",
    "conversation_id",
    "connection_id",
    "source_ai_message_run_id",
  ]) {
    assert.equal(updateStatement.includes(`${immutableField} =`), false);
  }
});

test("stale quarantine returns only a safe bounded count", async () => {
  const quarantineFunction = requireAiReplyQuarantineFunction(
    await readAiReplyQuarantineMigration(),
  );
  const returnProjection = quarantineFunction.match(
    /returns table \([\s\S]*?\)\s*language plpgsql/i,
  )?.[0];

  assert.ok(returnProjection);
  assert.match(returnProjection, /quarantined_count integer/i);
  for (const forbidden of [
    "dispatch_id",
    "ai_message_run",
    "organization_id",
    "conversation_id",
    "phone",
    "recipient",
    "text",
    "provider",
    "prompt",
    "openai",
  ]) {
    assert.equal(returnProjection.toLowerCase().includes(forbidden), false);
  }
  assert.match(
    quarantineFunction,
    /select count\(\*\)::integer\s+into affected_count[\s\S]*return query select affected_count/i,
  );
});

test("stale quarantine RPC is service-role-only without new table grants", async () => {
  const migration = await readAiReplyQuarantineMigration();
  const quarantineFunction = requireAiReplyQuarantineFunction(migration);

  assert.match(quarantineFunction, /security definer/i);
  assert.match(quarantineFunction, /set search_path = ''/i);
  assert.match(
    migration,
    /revoke all\s+on function public\.quarantine_stale_ai_reply_whatsapp_dispatches\(integer\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant execute\s+on function public\.quarantine_stale_ai_reply_whatsapp_dispatches\(integer\)\s+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (select|insert|update|delete|truncate|references|trigger)[\s\S]*on (table )?public\.whatsapp_outbound_dispatches/i,
  );
  assert.doesNotMatch(migration, /grant .* to anon/i);
  assert.doesNotMatch(migration, /grant .* to authenticated/i);
  assert.doesNotMatch(migration, /disable row level security/i);
});

test("stale quarantine repository normalizes default, minimum, and maximum limits", async () => {
  const limits: number[] = [];
  const rpc = async (_functionName: string, parameters: Record<string, unknown>) => {
    limits.push(parameters.p_limit as number);
    return { data: [{ quarantined_count: 0 }], error: null };
  };

  await quarantineStaleAiReplyWhatsappDispatchesWithRpc(undefined, rpc);
  await quarantineStaleAiReplyWhatsappDispatchesWithRpc(0, rpc);
  await quarantineStaleAiReplyWhatsappDispatchesWithRpc(100, rpc);
  await quarantineStaleAiReplyWhatsappDispatchesWithRpc(12.9, rpc);

  assert.deepEqual(limits, [25, 1, 50, 12]);
});

test("stale quarantine repository validates the exact bounded result", async () => {
  const result = await quarantineStaleAiReplyWhatsappDispatchesWithRpc(
    5,
    async (functionName, parameters) => {
      assert.equal(functionName, "quarantine_stale_ai_reply_whatsapp_dispatches");
      assert.deepEqual(parameters, { p_limit: 5 });
      return { data: [{ quarantined_count: 3 }], error: null };
    },
  );
  assert.deepEqual(result, { quarantinedCount: 3 });

  for (const data of [
    [{ quarantined_count: -1 }],
    [{ quarantined_count: 6 }],
    [{ quarantined_count: 1.5 }],
    [{ quarantined_count: "1" }],
    [{ quarantined_count: 1, dispatch_id: DISPATCH_ID }],
    [],
  ]) {
    await assert.rejects(
      quarantineStaleAiReplyWhatsappDispatchesWithRpc(
        5,
        async () => ({ data, error: null }),
      ),
      new RegExp(SAFE_REPOSITORY_ERROR.replaceAll(".", "\\.")),
    );
  }

  let rpcCalls = 0;
  assert.throws(() =>
    quarantineStaleAiReplyWhatsappDispatchesWithRpc(
      Number.NaN,
      async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    ),
  );
  assert.equal(rpcCalls, 0);
});

test("stale quarantine repository hides raw database errors", async () => {
  const sensitive = "raw dispatch, customer, and provider database detail";

  for (const rpc of [
    async () => ({ data: null, error: { message: sensitive } }),
    async () => {
      throw new Error(sensitive);
    },
  ]) {
    await assert.rejects(
      quarantineStaleAiReplyWhatsappDispatchesWithRpc(25, rpc),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, SAFE_REPOSITORY_ERROR);
        assert.equal(error.message.includes(sensitive), false);
        return true;
      },
    );
  }
});
