import assert from "node:assert/strict";
import test from "node:test";

import { BUSINESS_CONTEXT_TEMPLATES } from "../templates.ts";
import type { AiManagerHandoffSettings } from "../types.ts";
import { getAiManagerWarnings } from "./ai-manager-settings.ts";

const safeHandoff: AiManagerHandoffSettings = {
  aiUncertain: true,
  bookingError: true,
  clientRequestsAdmin: true,
  customerComplaint: true,
  medicalQuestion: true,
  otherCases: "",
  paymentDispute: true,
};

test("localized templates stay draft while placeholders are present", () => {
  assert.deepEqual(
    getAiManagerWarnings({ handoff: safeHandoff, rawBusinessContext: BUSINESS_CONTEXT_TEMPLATES.ru }),
    ["address_missing", "payment_methods_missing", "cancellation_rules_missing"],
  );
  assert.deepEqual(
    getAiManagerWarnings({ handoff: safeHandoff, rawBusinessContext: BUSINESS_CONTEXT_TEMPLATES.kk }),
    ["address_missing", "payment_methods_missing", "cancellation_rules_missing"],
  );
});

test("complete Russian and Kazakh contexts can become ready", () => {
  const ru = "Адрес:\nАлматы, Абая 1\nСпособы оплаты:\nкарта\nОтмена:\nза 2 часа";
  const kk = "Мекенжай:\nАлматы, Абай 1\nТөлем тәсілдері:\nкарта\nБас тарту:\n2 сағат бұрын";
  assert.deepEqual(getAiManagerWarnings({ handoff: safeHandoff, rawBusinessContext: ru }), []);
  assert.deepEqual(getAiManagerWarnings({ handoff: safeHandoff, rawBusinessContext: kk }), []);
});

test("handoff is required and an explicit other case satisfies it", () => {
  const context = "Адрес: Алматы\nСпособы оплаты: карта\nПравила отмены: заранее";
  const none: AiManagerHandoffSettings = {
    aiUncertain: false,
    bookingError: false,
    clientRequestsAdmin: false,
    customerComplaint: false,
    medicalQuestion: false,
    otherCases: "",
    paymentDispute: false,
  };
  assert.equal(getAiManagerWarnings({ handoff: none, rawBusinessContext: context }).at(-1), "handoff_rules_missing");
  assert.deepEqual(getAiManagerWarnings({ handoff: { ...none, otherCases: "Особый запрос" }, rawBusinessContext: context }), []);
});
