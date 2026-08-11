import { z } from "zod";

import type {
  AiManagerHandoffSettings,
  AiManagerWarningCode,
} from "../types";

const checkboxValue = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

export const aiManagerSettingsSchema = z.object({
  communicationStyle: z.enum(["friendly", "neutral", "formal"]),
  expectedVersion: z.coerce.number().int().min(0),
  formality: z.enum(["formal", "informal"]),
  handoffAiUncertain: checkboxValue,
  handoffBookingError: checkboxValue,
  handoffClientRequestsAdmin: checkboxValue,
  handoffCustomerComplaint: checkboxValue,
  handoffMedicalQuestion: checkboxValue,
  handoffOtherCases: z.string().trim().max(2_000),
  handoffPaymentDispute: checkboxValue,
  organizationId: z.string().uuid(),
  primaryLanguage: z.enum(["ru", "kk"]),
  rawBusinessContext: z.string().trim().min(1).max(30_000),
});

export const restoreAiManagerSettingsSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  organizationId: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

function hasCompletedField(context: string, labels: string[]): boolean {
  return labels.some((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = context.match(
      new RegExp(
        `(?:^|\\n)[ \\t]*${escaped}[ \\t]*:[ \\t]*(?:\\r?\\n[ \\t]*)?([^\\n]+)`,
        "i",
      ),
    );
    const value = match?.[1]?.trim() ?? "";
    return value.length >= 3 && !value.startsWith("[");
  });
}

export function getAiManagerWarnings(input: {
  handoff: AiManagerHandoffSettings;
  rawBusinessContext: string;
}): AiManagerWarningCode[] {
  const warnings: AiManagerWarningCode[] = [];

  if (!hasCompletedField(input.rawBusinessContext, ["Адрес", "Мекенжай"])) {
    warnings.push("address_missing");
  }
  if (
    !hasCompletedField(input.rawBusinessContext, [
      "Способы оплаты",
      "Төлем тәсілдері",
    ])
  ) {
    warnings.push("payment_methods_missing");
  }
  if (
    !hasCompletedField(input.rawBusinessContext, [
      "Правила отмены",
      "Отмена",
      "Бас тарту ережелері",
      "Бас тарту",
    ])
  ) {
    warnings.push("cancellation_rules_missing");
  }

  const { otherCases, ...handoffFlags } = input.handoff;
  if (
    !Object.values(handoffFlags).some(Boolean) &&
    otherCases.trim().length < 3
  ) {
    warnings.push("handoff_rules_missing");
  }

  return warnings;
}

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
