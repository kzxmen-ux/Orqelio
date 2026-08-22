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
  prepareWhatsappOutboundDispatchWithRpc,
  recordWhatsappOutboundProviderAcceptanceWithRpc,
} from "./outbound-dispatch-repository-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const DISPATCH_ID = "44444444-4444-4444-8444-444444444444";
const MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const PROVIDER_MESSAGE_ID = "wamid.safe-provider-id";
const SAFE_INPUT = {
  conversationId: CONVERSATION_ID,
  organizationId: ORGANIZATION_ID,
  text: "Safe outbound text",
};

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
