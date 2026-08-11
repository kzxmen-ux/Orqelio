import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AiManagerConfiguration } from "../ai-manager-settings/types.ts";
import { loadAuthorizedHandoffPolicy } from "./loader.ts";
import {
  buildHandoffPolicy,
  getHandoffReadiness,
  shouldHandoff,
} from "./policy.ts";

const organizationId = "40000000-0000-4000-8000-000000000001";

function configuration(
  handoff: Partial<AiManagerConfiguration["handoff"]> = {},
): AiManagerConfiguration {
  return {
    communicationStyle: "friendly",
    createdAt: "2026-08-11T10:00:00.000Z",
    formality: "formal",
    handoff: {
      aiUncertain: true,
      bookingError: true,
      clientRequestsAdmin: true,
      customerComplaint: true,
      medicalQuestion: true,
      otherCases: "",
      paymentDispute: true,
      ...handoff,
    },
    organizationId,
    primaryLanguage: "ru",
    rawBusinessContext: "Private business context that is never copied into policy decisions.",
    status: "ready",
    updatedAt: "2026-08-11T11:00:00.000Z",
    updatedBy: "10000000-0000-4000-8000-000000000001",
    version: 7,
  };
}

describe("handoff policy evaluation", () => {
  test("always honors an explicit customer request for a human", () => {
    const policy = buildHandoffPolicy(organizationId, configuration({ clientRequestsAdmin: false }));
    assert.deepEqual(shouldHandoff(policy, { trigger: "customer_requests_human" }), {
      policyVersion: 7,
      reasonCode: "customer_requested_human",
      safeReason: "The customer requested a person.",
      shouldHandoff: true,
    });
  });

  test("hands off when AI cannot understand and the rule is enabled", () => {
    const policy = buildHandoffPolicy(organizationId, configuration());
    assert.equal(shouldHandoff(policy, { trigger: "ai_cannot_understand" }).reasonCode, "ai_cannot_understand");
  });

  test("hands off a booking error when configured", () => {
    const policy = buildHandoffPolicy(organizationId, configuration());
    const result = shouldHandoff(policy, {
      actionRequired: false,
      trigger: "booking_error",
      unrecoverable: false,
    });
    assert.equal(result.reasonCode, "booking_error");
  });

  test("hands off a customer complaint when configured", () => {
    const policy = buildHandoffPolicy(organizationId, configuration());
    assert.equal(shouldHandoff(policy, { trigger: "customer_complaint" }).reasonCode, "customer_complaint");
  });

  test("medical scenarios are mandatory even when the organization flag is disabled", () => {
    const policy = buildHandoffPolicy(organizationId, configuration({ medicalQuestion: false }));
    assert.equal(shouldHandoff(policy, { trigger: "medical_question_or_contraindication" }).reasonCode, "medical_safety_review");
  });

  test("refund and payment disputes are mandatory even when disabled in settings", () => {
    const policy = buildHandoffPolicy(organizationId, configuration({ paymentDispute: false }));
    assert.equal(shouldHandoff(policy, { trigger: "refund_or_payment_dispute" }).reasonCode, "payment_dispute_review");
  });

  test("disabled optional rules do not cause handoff", () => {
    const policy = buildHandoffPolicy(
      organizationId,
      configuration({ aiUncertain: false, bookingError: false, customerComplaint: false }),
    );
    assert.equal(shouldHandoff(policy, { trigger: "ai_cannot_understand" }).shouldHandoff, false);
    assert.equal(shouldHandoff(policy, { actionRequired: false, trigger: "booking_error", unrecoverable: false }).shouldHandoff, false);
    assert.equal(shouldHandoff(policy, { trigger: "customer_complaint" }).shouldHandoff, false);
  });

  test("an unrecoverable required booking action cannot be disabled", () => {
    const policy = buildHandoffPolicy(organizationId, configuration({ bookingError: false }));
    const result = shouldHandoff(policy, {
      actionRequired: true,
      trigger: "booking_error",
      unrecoverable: true,
    });
    assert.equal(result.reasonCode, "unrecoverable_booking_failure");
    assert.equal(result.shouldHandoff, true);
  });

  test("custom instructions are preserved server-side and only return a safe decision", () => {
    const customInstructions = "Передать администратору при запросе корпоративного обслуживания.";
    const policy = buildHandoffPolicy(organizationId, configuration({ otherCases: customInstructions }));
    const result = shouldHandoff(policy, { matched: true, trigger: "custom_handoff_instruction" });
    assert.equal(policy.organizationRules.customInstructions, customInstructions);
    assert.equal(policy.readiness.customRulesPresent, true);
    assert.equal(result.reasonCode, "custom_policy_match");
    assert.equal(result.safeReason?.includes(customInstructions), false);
  });

  test("returns the exact configuration version with every decision", () => {
    const policy = buildHandoffPolicy(organizationId, configuration());
    assert.equal(shouldHandoff(policy, { trigger: "customer_complaint" }).policyVersion, 7);
    assert.equal(shouldHandoff(policy, { matched: false, trigger: "custom_handoff_instruction" }).policyVersion, 7);
  });

  test("reports default-policy readiness without inventing a stored configuration", () => {
    const readiness = getHandoffReadiness(buildHandoffPolicy(organizationId, null));
    assert.deepEqual(readiness, {
      configured: false,
      customRulesPresent: false,
      usesDefaultPolicy: true,
    });
  });
});

describe("handoff policy organization isolation", () => {
  test("does not read configuration for an unauthorized organization", async () => {
    let configurationRead = false;
    const result = await loadAuthorizedHandoffPolicy(organizationId, {
      getConfiguration: async () => {
        configurationRead = true;
        return configuration();
      },
      isAuthorized: async () => false,
    });
    assert.equal(result, null);
    assert.equal(configurationRead, false);
  });

  test("rejects a configuration returned for another organization", async () => {
    const result = await loadAuthorizedHandoffPolicy(organizationId, {
      getConfiguration: async () => ({
        ...configuration(),
        organizationId: "40000000-0000-4000-8000-000000000002",
      }),
      isAuthorized: async () => true,
    });
    assert.equal(result, null);
  });
});
