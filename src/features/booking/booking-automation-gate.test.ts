import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isBookingAutomationAllowedWithRpc } from "./booking-automation-gate-core.ts";

const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  aiMessageRunId: "22222222-2222-4222-8222-222222222222",
};

test("rollout gate sends only exact tenant/run identity to trusted database predicate", async () => {
  for (const allowed of [false, true]) {
    assert.equal(await isBookingAutomationAllowedWithRpc(input, async (name, parameters) => {
      assert.equal(name, "booking_automation_allows_run");
      assert.deepEqual(parameters, { p_organization_id: input.organizationId, p_ai_message_run_id: input.aiMessageRunId });
      return { data: allowed, error: null };
    }), allowed);
  }
});

test("rollout gate fails closed on malformed data, invalid binding and query errors", async () => {
  for (const data of [null, undefined, "true", 1, [], [{ allowed: true }]]) {
    assert.equal(await isBookingAutomationAllowedWithRpc(input, async () => ({ data, error: null })), false);
  }
  assert.equal(await isBookingAutomationAllowedWithRpc(input, async () => ({ data: true, error: "private details" })), false);
  assert.equal(await isBookingAutomationAllowedWithRpc(input, async () => { throw new Error("private details"); }), false);
  assert.equal(await isBookingAutomationAllowedWithRpc({ ...input, organizationId: "invalid" }, async () => { assert.fail("invalid identity must not reach DB"); }), false);
});

test("migration defaults disabled with no activations and protects every durable booking entry", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20260830194500_booking_automation_rollout_gate.sql", import.meta.url), "utf8");
  assert.match(sql, /activated_at timestamptz default null/);
  assert.match(sql, /p_created_at >= p_activated_at/);
  assert.match(sql, /booking_activation_allows_run\(rollout.activated_at, run.created_at\)/);
  assert.match(sql, /rollout.organization_id = run.organization_id/);
  assert.match(sql, /run.id = p_ai_message_run_id and run.organization_id = p_organization_id/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on private.booking_automation_rollouts from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /insert into|update public.ai_message_runs|delete from|create or replace function public.prepare_ai_reply_whatsapp_dispatch/);
  for (const name of ["load_booking_action_source", "get_ai_booking_whatsapp_context", "list_actionable_ai_booking_whatsapp_executions", "claim_booking_mutation_execution", "claim_ai_reply_whatsapp_dispatch_execution"]) {
    const body = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0];
    assert.ok(body, name);
    assert.match(body, /booking_automation_allows_run\(/);
  }
  assert.match(sql, /run.decision ->> 'action' = 'reply'\s+or \(run.decision ->> 'action' = 'booking_action_required' and public.booking_automation_allows_run/);
  const wrapper = readFileSync(new URL("./booking-automation-gate.ts", import.meta.url), "utf8");
  assert.match(wrapper, /^import "server-only";/);
  assert.match(wrapper, /createPrivilegedClient/);
});
