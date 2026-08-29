import type { HandoffReasonCode } from "../handoff-policy/types.ts";

export const MODEL_RESPONSE_INTENTS = [
  "reply",
  "booking_action_required",
  "handoff_candidate",
  "cannot_answer",
] as const;

export const MODEL_BOOKING_INTENTS = [
  "none",
  "check_availability",
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
] as const;

export const MODEL_HANDOFF_TRIGGERS = [
  "none",
  "ai_cannot_understand",
  "customer_complaint",
  "customer_requests_human",
  "medical_question_or_contraindication",
  "refund_or_payment_dispute",
  "custom_handoff_instruction",
] as const;

export const MAX_MODEL_REPLY_CHARACTERS = 2_000;
export const MAX_MODEL_BOOKING_REQUEST_FIELD_CHARACTERS = 500;

export const MODEL_BOOKING_REQUEST_FIELDS = [
  "serviceQuery",
  "staffQuery",
  "dateText",
  "timeText",
  "customerName",
  "customerPhone",
  "appointmentReference",
] as const;

export type ModelResponseIntent = (typeof MODEL_RESPONSE_INTENTS)[number];
export type ModelBookingIntent = (typeof MODEL_BOOKING_INTENTS)[number];
export type ModelHandoffTrigger = (typeof MODEL_HANDOFF_TRIGGERS)[number];

export type ModelBookingRequest = {
  serviceQuery: string | null;
  staffQuery: string | null;
  dateText: string | null;
  timeText: string | null;
  customerName: string | null;
  customerPhone: string | null;
  appointmentReference: string | null;
};

export type ModelProposal =
  | {
      responseIntent: "reply";
      replyText: string;
      bookingIntent: "none";
      bookingRequest: null;
      handoffTrigger: "none";
    }
  | {
      responseIntent: "booking_action_required";
      replyText: null;
      bookingIntent: Exclude<ModelBookingIntent, "none">;
      bookingRequest: ModelBookingRequest;
      handoffTrigger: "none";
    }
  | {
      responseIntent: "handoff_candidate";
      replyText: string | null;
      bookingIntent: "none";
      bookingRequest: null;
      handoffTrigger: Exclude<ModelHandoffTrigger, "none">;
    }
  | {
      responseIntent: "cannot_answer";
      replyText: null;
      bookingIntent: "none";
      bookingRequest: null;
      handoffTrigger: "none" | "ai_cannot_understand";
    };

export type ModelProposalValidationResult =
  | { valid: true; proposal: ModelProposal }
  | { valid: false };

export type AiRuntimeDecision =
  | { action: "reply"; text: string }
  | {
      action: "booking_action_required";
      bookingIntent: Exclude<ModelBookingIntent, "none">;
      bookingRequest: ModelBookingRequest;
    }
  | {
      action: "handoff";
      reasonCode: HandoffReasonCode;
      safeReason: string;
    }
  | {
      action: "no_safe_answer";
      reason: "model_invalid" | "model_cannot_answer";
    };
