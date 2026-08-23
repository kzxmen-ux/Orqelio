import type { AiManagerConfiguration } from "../ai-manager-settings/types";
import type {
  HandoffDecision,
  HandoffEvaluationContext,
  HandoffOrganizationRules,
  HandoffPolicy,
  HandoffReadiness,
  HandoffReasonCode,
} from "./types";

export const MANDATORY_HANDOFF_REASON_CODES = Object.freeze([
  "customer_requested_human",
  "medical_safety_review",
  "payment_dispute_review",
  "unrecoverable_booking_failure",
] as const satisfies readonly HandoffReasonCode[]);

const DEFAULT_ORGANIZATION_RULES: Readonly<HandoffOrganizationRules> = {
  aiCannotUnderstand: true,
  bookingError: true,
  customerComplaint: true,
  customerRequestsHuman: true,
  customInstructions: "",
  medicalQuestionOrContraindication: true,
  refundOrPaymentDispute: true,
};

const SAFE_REASONS: Record<HandoffReasonCode, string> = {
  ai_cannot_understand: "The request requires human clarification.",
  booking_error: "The booking issue requires human assistance.",
  customer_complaint: "The complaint requires human review.",
  customer_requested_human: "The customer requested a person.",
  custom_policy_match: "An organization handoff rule matched.",
  medical_safety_review: "The request requires human medical-safety review.",
  payment_dispute_review: "The payment or refund dispute requires a human decision.",
  unrecoverable_booking_failure: "A required booking action could not be completed safely.",
};

export function buildHandoffPolicy(
  organizationId: string,
  configuration: Pick<AiManagerConfiguration, "handoff" | "version"> | null,
): HandoffPolicy {
  const organizationRules: Readonly<HandoffOrganizationRules> = configuration
    ? {
        aiCannotUnderstand: configuration.handoff.aiUncertain,
        bookingError: configuration.handoff.bookingError,
        customerComplaint: configuration.handoff.customerComplaint,
        customerRequestsHuman: configuration.handoff.clientRequestsAdmin,
        customInstructions: configuration.handoff.otherCases,
        medicalQuestionOrContraindication: configuration.handoff.medicalQuestion,
        refundOrPaymentDispute: configuration.handoff.paymentDispute,
      }
    : DEFAULT_ORGANIZATION_RULES;

  return {
    organizationId,
    organizationRules,
    policyVersion: configuration?.version ?? 0,
    readiness: {
      configured: configuration !== null,
      customRulesPresent: organizationRules.customInstructions.trim().length > 0,
      usesDefaultPolicy: configuration === null,
    },
  };
}

export function getHandoffReadiness(policy: HandoffPolicy): HandoffReadiness {
  return policy.readiness;
}

function decision(policy: HandoffPolicy, reasonCode: HandoffReasonCode | null): HandoffDecision {
  return {
    policyVersion: policy.policyVersion,
    reasonCode,
    safeReason: reasonCode ? SAFE_REASONS[reasonCode] : null,
    shouldHandoff: reasonCode !== null,
  };
}

function getMandatoryReason(
  context: HandoffEvaluationContext,
): HandoffReasonCode | null {
  switch (context.trigger) {
    case "customer_requests_human":
      return "customer_requested_human";
    case "medical_question_or_contraindication":
      return "medical_safety_review";
    case "refund_or_payment_dispute":
      return "payment_dispute_review";
    case "booking_error":
      return context.unrecoverable && context.actionRequired
        ? "unrecoverable_booking_failure"
        : null;
    case "ai_cannot_understand":
    case "customer_complaint":
    case "custom_handoff_instruction":
      return null;
  }
}

export function shouldHandoff(
  policy: HandoffPolicy,
  context: HandoffEvaluationContext,
): HandoffDecision {
  const mandatoryReason = getMandatoryReason(context);

  if (mandatoryReason) {
    return decision(policy, mandatoryReason);
  }

  switch (context.trigger) {
    case "customer_requests_human":
    case "medical_question_or_contraindication":
    case "refund_or_payment_dispute":
      return decision(policy, null);
    case "booking_error":
      return decision(policy, policy.organizationRules.bookingError ? "booking_error" : null);
    case "ai_cannot_understand":
      return decision(policy, policy.organizationRules.aiCannotUnderstand ? "ai_cannot_understand" : null);
    case "customer_complaint":
      return decision(policy, policy.organizationRules.customerComplaint ? "customer_complaint" : null);
    case "custom_handoff_instruction":
      return decision(
        policy,
        context.matched && policy.readiness.customRulesPresent
          ? "custom_policy_match"
          : null,
      );
  }
}
