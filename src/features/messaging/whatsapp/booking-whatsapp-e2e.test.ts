import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBookingResultResponse } from "./booking-result-response-core.ts";
import { executeAiBookingWhatsappWithDependencies, type AiBookingWhatsappDependencies } from "./ai-booking-whatsapp-executor-core.ts";
import { executeAiReplyWhatsappWithDependencies } from "./ai-reply-whatsapp-executor-core.ts";
import { executeAiBookingActionCore, type AiBookingActionExecutionResult } from "../../booking/ai-booking-action-executor-core.ts";
import type { BookingMutationTerminalResult } from "../../booking/booking-mutation-execution-repository-core.ts";
import type { WhatsappOutboundDispatchResult, WhatsappOutboundDispatchState } from "./outbound-dispatch-repository-core.ts";
import { loadAiBookingWhatsappContextWithRpc, prepareAiBookingWhatsappDispatchWithRpc, listActionableAiBookingWhatsappExecutionsWithRpc } from "./outbound-dispatch-repository-core.ts";
import { getImmediateAiBookingExecutionCandidate, getImmediateAiReplyWhatsappExecutionCandidate, processWhatsappInboxEventWithDependencies } from "./inbox-processor-core.ts";
import { runAiReplyWhatsappExecutionWorkerWithDependencies } from "./ai-reply-whatsapp-execution-worker-core.ts";
import type { DurableAiInboundProcessingResult } from "../../ai-runtime/durable-inbound-processing-core.ts";

const org = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";
const dispatchId = "33333333-3333-4333-8333-333333333333";
const input = { organizationId: org, aiMessageRunId: run };
const aiInput = { organizationId: org, conversationId: dispatchId, triggerMessageId: run };
const request = { serviceQuery: "Стрижка", staffQuery: null, dateText: "завтра", timeText: "15:00", customerName: "Айдана", customerPhone: "UNTRUSTED", appointmentReference: null };
const appointment = { id: "SECRET-APPOINTMENT", serviceId: "SECRET-SERVICE", staffId: "SECRET-STAFF", startAt: "2026-08-31T10:00:00.000Z", endAt: "2026-08-31T11:00:00.000Z", status: "confirmed" as const };
const locale = { language: "ru" as const, timeZone: "Asia/Almaty" };
const bookingDecision: DurableAiInboundProcessingResult = { outcome: "completed", runId: run, aiResult: { outcome: "decided", decision: { action: "booking_action_required", bookingIntent: "create_appointment", bookingRequest: request } } };

function harness(result?: AiBookingActionExecutionResult) {
  let dispatch: WhatsappOutboundDispatchResult | null = null;
  let text = "";
  let terminal: BookingMutationTerminalResult | null = null;
  let executing = false;
  let preparations = 0;
  let creates = 0;
  let sends = 0;
  let executions = 0;
  let composeCalls = 0;
  const faults = { prepare: false, send: false, acceptance: false, finalize: false };
  const setState = (state: WhatsappOutboundDispatchState) => { dispatch = { dispatchId, state }; return dispatch; };
  const deps: AiBookingWhatsappDependencies = {
    loadContext: async (identity) => { assert.deepEqual(identity, input); return { language: "ru", dispatch }; },
    loadTimeContext: async (organizationId) => { assert.equal(organizationId, org); return { success: true, context: { timeZone: locale.timeZone } }; },
    executeAiBookingAction: async (identity) => {
      executions++;
      assert.deepEqual(identity, input);
      if (result) return result;
      const trustedRequest = { intent: "create_appointment" as const, serviceId: appointment.serviceId, staffId: appointment.staffId, startAt: appointment.startAt, customer: { name: "Айдана", phone: "77001234567" } };
      return executeAiBookingActionCore({ ...identity, nowInstant: "2026-08-30T10:00:00.000Z" }, {
        loadBookingActionSource: async () => ({ success: true, source: { conversationId: dispatchId, bookingIntent: "create_appointment", bookingRequest: request } }),
        findBookingMutationExecution: async () => terminal || executing ? { executionId: dispatchId, state: terminal ? terminal.success ? "succeeded" : "indeterminate" : "executing", result: terminal } : null,
        composeBookingRequestForOrganization: async () => { composeCalls++; return { status: "ready", request: trustedRequest }; },
        prepareBookingMutationExecution: async () => ({ executionId: dispatchId, state: "prepared", result: null }),
        claimBookingMutationExecution: async () => {
          if (terminal) return { executionId: dispatchId, outcome: terminal.success ? "succeeded" : "indeterminate", result: terminal };
          if (executing) return { executionId: dispatchId, outcome: "already_executing" };
          executing = true;
          return { executionId: dispatchId, outcome: "claimed", trustedRequest };
        },
        executeBookingForOrganization: async () => { creates++; return { status: "executed", intent: "create_appointment", result: { success: true, data: appointment } }; },
        recordBookingMutationSuccess: async (_identity, value) => { terminal = value; return { executionId: dispatchId, state: "succeeded", result: value }; },
        recordBookingMutationFailure: async () => { assert.fail("unexpected definitive failure"); },
        markBookingMutationIndeterminate: async () => { terminal = { success: false, code: "provider_error", retryable: false }; return { executionId: dispatchId, state: "indeterminate", result: terminal }; },
      });
    },
    prepareResponse: async (_identity, response) => {
      if (faults.prepare) throw new Error("crash before response persisted");
      if (dispatch) return dispatch;
      preparations++; text = response; return setState("prepared");
    },
    executeDispatch: async (identity, prepared) => executeAiReplyWhatsappWithDependencies(identity, {
      prepareAiReplyWhatsappDispatch: async () => prepared,
      claimAiReplyWhatsappDispatchExecution: async () => {
        if (dispatch?.state !== "prepared") return { dispatchId, outcome: dispatch?.state === "dispatching" ? "already_dispatching" : dispatch?.state ?? "indeterminate" };
        setState("dispatching");
        return { outcome: "claimed", dispatchId, phoneNumberId: "100000", recipientWaId: "77001234567", text };
      },
      sendWhatsappTextMessage: async (message) => { sends++; assert.equal(message.text, text); if (faults.send) throw new Error("Meta outcome unknown"); return { providerMessageId: "wamid.MOCK-ONLY" }; },
      recordWhatsappOutboundProviderAcceptance: async () => { if (faults.acceptance) throw new Error("DB unavailable after Meta acceptance"); return setState("provider_accepted"); },
      finalizeWhatsappOutboundDispatch: async () => { if (faults.finalize) throw new Error("DB unavailable"); setState("persisted"); return { outcome: "accepted", messageId: run }; },
      markWhatsappOutboundDispatchIndeterminate: async () => setState("indeterminate"),
    }),
  };
  return { deps, faults, setState, execute: () => executeAiBookingWhatsappWithDependencies(input, deps), counts: () => ({ preparations, creates, sends, executions, composeCalls }), text: () => text,
    quarantineMutation: () => { terminal = { success: false, code: "provider_error", retryable: false }; },
  };
}

test("booking candidate contains only durable identity; reply candidate remains unchanged", () => {
  assert.deepEqual(getImmediateAiBookingExecutionCandidate(aiInput, bookingDecision), input);
  assert.equal(getImmediateAiReplyWhatsappExecutionCandidate(aiInput, bookingDecision), null);
  const reply: DurableAiInboundProcessingResult = { outcome: "completed", runId: run, aiResult: { outcome: "decided", decision: { action: "reply", text: "Здравствуйте" } } };
  assert.equal(getImmediateAiBookingExecutionCandidate(aiInput, reply), null);
  assert.deepEqual(getImmediateAiReplyWhatsappExecutionCandidate(aiInput, reply), input);
  for (const value of [{ outcome: "already_terminal" as const, runId: run, status: "decided" as const }, { outcome: "already_processing" as const, runId: run }]) assert.equal(getImmediateAiBookingExecutionCandidate(aiInput, value), null);
});

test("inbox completes durable event before booking execution and does not use reply path", async () => {
  const calls: string[] = [];
  const result = await processWhatsappInboxEventWithDependencies(run, {
    claimEvent: async () => ({ outcome: "claimed", rawPayload: {} }),
    routePayload: async () => [{ organizationId: org, type: "text" }], routeStatuses: async () => [],
    storeMessage: async () => ({ outcome: "accepted", conversationId: dispatchId, messageId: run }), storeStatus: async () => undefined,
    processDurableAi: async () => bookingDecision,
    completeEvent: async () => { calls.push("complete"); }, failEvent: async () => undefined,
    executeImmediateReply: async () => { assert.fail("reply path must not run"); },
    executeImmediateBooking: async (identity) => { assert.deepEqual(identity, input); calls.push("booking"); return { outcome: "persisted", dispatchId }; },
  });
  assert.deepEqual(calls, ["complete", "booking"]);
  assert.equal(result.outcome === "processed" && result.immediateBookingExecution?.persistedCount, 1);
});

for (const language of ["ru", "kk"] as const) {
  test(`${language}: only verified create success confirms, no internal IDs`, () => {
    const text = buildBookingResultResponse({ status: "create_succeeded", appointment }, { ...locale, language });
    assert.match(text ?? "", language === "ru" ? /Запись подтверждена/ : /Жазылуыңыз расталды/);
    assert.match(text ?? "", /15:00/);
    assert.doesNotMatch(text ?? "", /SECRET|UNTRUSTED/);
    const failed = buildBookingResultResponse({ status: "create_failed", code: "slot_unavailable", retryable: false }, { ...locale, language });
    assert.match(failed ?? "", language === "ru" ? /другое время/ : /Басқа уақыт/);
    assert.doesNotMatch(failed ?? "", /подтверждена|расталды/);
  });
}

test("trusted organization timezone changes formatting, never phone or server timezone", () => {
  const result = { status: "create_succeeded" as const, appointment };
  assert.match(buildBookingResultResponse(result, { ...locale, timeZone: "Europe/Berlin" }) ?? "", /12:00/);
  assert.match(buildBookingResultResponse(result, locale) ?? "", /15:00/);
});

test("availability renders at most five unique local times, not staff IDs", () => {
  const data = Array.from({ length: 10 }, (_, i) => ({ startAt: `2026-08-31T${String(10 + Math.floor(i / 2)).padStart(2, "0")}:00:00Z`, endAt: "2026-08-31T20:00:00Z", staffId: `SECRET-${i}` }));
  const text = buildBookingResultResponse({ status: "availability", result: { success: true, data } }, locale) ?? "";
  assert.equal((text.match(/\d{2}:00/g) ?? []).length, 5);
  assert.doesNotMatch(text, /SECRET|подтверждена/);
});

test("availability runs through the durable mocked sender using configured Kazakh language", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { assert.fail("real network is forbidden"); });
  const h = harness({ status: "availability", result: { success: true, data: [{ startAt: appointment.startAt, endAt: appointment.endAt, staffId: "SECRET" }] } });
  h.deps.loadContext = async () => ({ language: "kk", dispatch: null });
  await h.execute();
  assert.match(h.text(), /Бос уақыттар/); assert.match(h.text(), /15:00/);
  assert.doesNotMatch(h.text(), /SECRET/); assert.equal(h.counts().creates, 0);
  assert.equal(network.mock.callCount(), 0);
});

test("clarification contains display names only and temporal options are not interpolated", () => {
  const text = buildBookingResultResponse({ status: "needs_clarification", field: "staffQuery", options: ["  Алексей  ", "Алексей", "Айдана"] }, locale);
  assert.equal(text, "К какому специалисту хотите записаться?\nАлексей; Айдана");
  assert.equal(buildBookingResultResponse({ status: "needs_clarification", field: "dateText", options: ["SECRET"] }, locale), "На какую дату хотите записаться?");
});

test("needs input, empty availability, failures, malformed times and uncertainty stay safe", () => {
  for (const language of ["ru", "kk"] as const) {
    for (const field of ["serviceQuery", "staffQuery", "dateText", "timeText", "customerName"] as const) assert.ok(buildBookingResultResponse({ status: "needs_input", field }, { ...locale, language }));
    for (const result of [
      { status: "availability" as const, result: { success: true as const, data: [] } },
      { status: "availability" as const, result: { success: false as const, code: "provider_error" as const, retryable: false } },
      { status: "unavailable" as const, code: "connection_unavailable" as const, retryable: true },
      { status: "indeterminate" as const },
      { status: "create_succeeded" as const, appointment: { ...appointment, startAt: "SECRET-no-offset" } },
    ]) {
      const text = buildBookingResultResponse(result, { ...locale, language });
      assert.ok(text);
      assert.doesNotMatch(text, /подтверждена|расталды|SECRET|provider_error|connection_unavailable/);
    }
  }
  assert.equal(buildBookingResultResponse({ status: "already_executing" }, locale), null);
});

test("full durable create to outbound path executes provider and mocked send once", async () => {
  const h = harness();
  await Promise.all([h.execute(), h.execute()]);
  await h.execute();
  assert.deepEqual(h.counts(), { preparations: 1, creates: 1, sends: 1, executions: 2, composeCalls: 2 });
  assert.match(h.text(), /Запись подтверждена/);
  assert.doesNotMatch(h.text(), /SECRET|UNTRUSTED/);
});

test("crash after booking before response preparation replays journal without recomposition or create", async () => {
  const h = harness(); h.faults.prepare = true;
  await assert.rejects(h.execute(), /^Error: Booking WhatsApp execution failed\.$/);
  h.faults.prepare = false;
  await h.execute();
  assert.deepEqual(h.counts(), { preparations: 1, creates: 1, sends: 1, executions: 2, composeCalls: 1 });
});

test("crash after preparation resumes outbound without another booking or locale lookup", async () => {
  const h = harness();
  const executeDispatch = h.deps.executeDispatch;
  h.deps.executeDispatch = async () => { throw new Error("crash before claim"); };
  await assert.rejects(h.execute());
  h.deps.executeDispatch = executeDispatch;
  h.deps.loadTimeContext = async () => { assert.fail("stored response needs no timezone read"); };
  await h.execute();
  assert.equal(h.counts().executions, 1); assert.equal(h.counts().sends, 1);
});

test("Meta accepted plus DB finalization failure recovers persistence only", async () => {
  const h = harness(); h.faults.finalize = true;
  assert.equal((await h.execute()).outcome, "provider_accepted");
  h.faults.finalize = false;
  assert.equal((await h.execute()).outcome, "persisted");
  assert.equal(h.counts().sends, 1); assert.equal(h.counts().creates, 1);
});

for (const fault of ["send", "acceptance"] as const) {
  test(`${fault}: ambiguous WhatsApp outcome never resends or repeats booking`, async () => {
    const h = harness(); h.faults[fault] = true;
    assert.equal((await h.execute()).outcome, "indeterminate");
    h.faults[fault] = false;
    assert.equal((await h.execute()).outcome, "indeterminate");
    assert.equal(h.counts().sends, 1); assert.equal(h.counts().creates, 1);
  });
}

test("booking uncertainty is sent once and never triggers another create", async () => {
  const h = harness(); h.quarantineMutation();
  await h.execute(); await h.execute();
  assert.equal(h.counts().creates, 0); assert.equal(h.counts().sends, 1);
  assert.match(h.text(), /неизвестен/); assert.match(h.text(), /Повторно записывать не буду/);
});

test("already executing booking produces no dispatch or message", async () => {
  const h = harness({ status: "already_executing" });
  assert.deepEqual(await h.execute(), { outcome: "already_executing" });
  assert.equal(h.counts().preparations, 0); assert.equal(h.counts().sends, 0);
});

test("recovery quarantines stale mutations before discovering interrupted booking responses", async () => {
  const calls: string[] = []; const h = harness();
  const result = await runAiReplyWhatsappExecutionWorkerWithDependencies(10, {
    quarantineStale: async () => { calls.push("quarantine"); h.quarantineMutation(); return { quarantinedCount: 1 }; },
    listActionable: async () => { calls.push("list"); return [input]; },
    executeReply: async () => { calls.push("execute"); return h.execute(); },
  });
  assert.deepEqual(calls, ["quarantine", "list", "execute"]);
  assert.equal(result.quarantinedCount, 1); assert.equal(result.persistedCount, 1);
  assert.equal(h.counts().creates, 0); assert.match(h.text(), /неизвестен/);
});

test("missing trusted language/timezone stops before booking, errors are generic", async () => {
  const h = harness(); h.deps.loadContext = async () => ({ dispatch: null, language: null });
  await assert.rejects(h.execute(), /^Error: Booking WhatsApp execution failed\.$/);
  assert.equal(h.counts().executions, 0);
  h.deps.loadContext = async () => ({ dispatch: null, language: "kk" });
  h.deps.loadTimeContext = async () => ({ success: false, code: "time_context_unavailable" });
  await assert.rejects(h.execute(), /^Error: Booking WhatsApp execution failed\.$/);
  assert.equal(h.counts().executions, 0);
});

test("booking outbound repository validates safe RPC rows, language and exact identities", async () => {
  const context = await loadAiBookingWhatsappContextWithRpc(input, async (name, params) => {
    assert.equal(name, "get_ai_booking_whatsapp_context");
    assert.deepEqual(params, { p_organization_id: org, p_ai_message_run_id: run });
    return { error: null, data: [{ primary_language: "kk", dispatch_id: dispatchId, state: "prepared", credentials: "MUST-NOT-LEAK" }] };
  });
  assert.deepEqual(context, { language: "kk", dispatch: { dispatchId, state: "prepared" } });
  for (const data of [[], [{ primary_language: "en", dispatch_id: null, state: null }], [{ primary_language: "ru", dispatch_id: "invalid", state: "prepared" }]]) await assert.rejects(loadAiBookingWhatsappContextWithRpc(input, async () => ({ data, error: null })), /repository operation failed/);
  await prepareAiBookingWhatsappDispatchWithRpc(input, "Безопасный ответ", async (name, params) => {
    assert.equal(name, "prepare_ai_booking_whatsapp_dispatch"); assert.equal(params.p_text, "Безопасный ответ");
    return { error: null, data: [{ dispatch_id: dispatchId, state: "prepared" }] };
  });
  await assert.rejects(loadAiBookingWhatsappContextWithRpc(input, async () => { throw new Error("SECRET"); }), /^Error: WhatsApp outbound dispatch repository operation failed\.$/);
  assert.deepEqual(await listActionableAiBookingWhatsappExecutionsWithRpc(5, async (name) => {
    assert.equal(name, "list_actionable_ai_booking_whatsapp_executions"); return { error: null, data: [{ organization_id: org, ai_message_run_id: run }] };
  }), [input]);
});

test("production wiring reuses sender and five-minute recovery; migration restricts RPCs and preserves atomic binding", () => {
  const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  const executor = source("./ai-booking-whatsapp-executor.ts");
  assert.match(executor, /^import "server-only";/); assert.match(executor, /executePreparedAiWhatsappDispatch/);
  assert.doesNotMatch(executor, /fetch\(|graph\.facebook|sendWhatsappTextMessage|DevelopmentProvider/);
  const worker = source("./ai-reply-whatsapp-execution-worker.ts");
  assert.match(worker, /quarantineStale: quarantineStaleBookingMutationExecutions/);
  assert.match(worker, /executeReply: executeAiBookingWhatsapp/);
  const sql = source("../../../../supabase/migrations/20260830191520_stage_5b_whatsapp_booking_e2e.sql");
  assert.match(sql, /on conflict \(source_ai_message_run_id\) do nothing/);
  assert.match(sql, /for update of run for share of conversation/);
  assert.match(sql, /for update of dispatch/);
  assert.match(sql, /run\.conversation_id = conversation\.id/);
  assert.match(sql, /run\.decision ->> 'action' in \('reply', 'booking_action_required'\)/);
  assert.match(sql, /execution\.state <> 'executing'/);
  assert.match(sql, /dispatch\.state = 'provider_accepted'/);
  assert.match(sql, /configuration\.primary_language::text/);
  assert.match(sql, /booking run already answered/);
  for (const signature of ["load_booking_action_source(uuid, uuid)", "find_booking_mutation_execution(uuid, uuid)", "get_ai_booking_whatsapp_context(uuid, uuid)", "prepare_ai_booking_whatsapp_dispatch(uuid, uuid, text)", "list_actionable_ai_booking_whatsapp_executions(integer)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated, service_role`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role`));
  }
  assert.doesNotMatch(sql, /create table|grant select|net\.http|cron\.schedule|credential|access_token/i);
});
