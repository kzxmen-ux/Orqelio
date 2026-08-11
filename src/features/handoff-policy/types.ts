export type HandoffTrigger =
  | "ai_cannot_understand"
  | "booking_error"
  | "customer_complaint"
  | "customer_requests_human"
  | "custom_handoff_instruction"
  | "medical_question_or_contraindication"
  | "refund_or_payment_dispute";

export type HandoffReasonCode =
  | "ai_cannot_understand"
  | "booking_error"
  | "customer_complaint"
  | "customer_requested_human"
  | "custom_policy_match"
  | "medical_safety_review"
  | "payment_dispute_review"
  | "unrecoverable_booking_failure";

export type HandoffOrganizationRules = {
  aiCannotUnderstand: boolean;
  bookingError: boolean;
  customerComplaint: boolean;
  customerRequestsHuman: boolean;
  customInstructions: string;
  medicalQuestionOrContraindication: boolean;
  refundOrPaymentDispute: boolean;
};

export type HandoffReadiness = {
  configured: boolean;
  customRulesPresent: boolean;
  usesDefaultPolicy: boolean;
};

export type HandoffPolicy = {
  organizationId: string;
  organizationRules: Readonly<HandoffOrganizationRules>;
  policyVersion: number;
  readiness: HandoffReadiness;
};

export type HandoffEvaluationContext =
  | { trigger: "ai_cannot_understand" }
  | {
      actionRequired: boolean;
      trigger: "booking_error";
      unrecoverable: boolean;
    }
  | { trigger: "customer_complaint" }
  | { trigger: "customer_requests_human" }
  | { matched: boolean; trigger: "custom_handoff_instruction" }
  | { trigger: "medical_question_or_contraindication" }
  | { trigger: "refund_or_payment_dispute" };

export type HandoffDecision = {
  policyVersion: number;
  reasonCode: HandoffReasonCode | null;
  safeReason: string | null;
  shouldHandoff: boolean;
};
