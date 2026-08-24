import type { ConversationAiContext } from "./conversation-context-core.ts";
import {
  MAX_MODEL_REPLY_CHARACTERS,
  MODEL_BOOKING_INTENTS,
  MODEL_HANDOFF_TRIGGERS,
  MODEL_RESPONSE_INTENTS,
  type AiRuntimeDecision,
  type ModelBookingIntent,
  type ModelHandoffTrigger,
  type ModelProposalValidationResult,
  type ModelResponseIntent,
} from "./decision-types.ts";
import { shouldHandoff } from "../handoff-policy/policy.ts";
import type {
  HandoffDecision,
  HandoffEvaluationContext,
} from "../handoff-policy/types.ts";

const MODEL_PROPOSAL_KEYS = Object.freeze([
  "responseIntent",
  "replyText",
  "bookingIntent",
  "handoffTrigger",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactProposalKeys(
  value: Record<string, unknown>,
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === MODEL_PROPOSAL_KEYS.length &&
    MODEL_PROPOSAL_KEYS.every((key) => Object.hasOwn(value, key))
  );
}

function isResponseIntent(value: unknown): value is ModelResponseIntent {
  return MODEL_RESPONSE_INTENTS.some((intent) => intent === value);
}

function isBookingIntent(value: unknown): value is ModelBookingIntent {
  return MODEL_BOOKING_INTENTS.some((intent) => intent === value);
}

function isHandoffTrigger(value: unknown): value is ModelHandoffTrigger {
  return MODEL_HANDOFF_TRIGGERS.some((trigger) => trigger === value);
}

function normalizeReplyText(
  value: unknown,
): { valid: true; text: string | null } | { valid: false } {
  if (value === null) return { valid: true, text: null };
  if (typeof value !== "string") return { valid: false };

  const text = value.trim();
  if (text.length === 0 || text.length > MAX_MODEL_REPLY_CHARACTERS) {
    return { valid: false };
  }

  return { valid: true, text };
}

export function validateModelProposal(
  value: unknown,
): ModelProposalValidationResult {
  if (!isRecord(value) || !hasExactProposalKeys(value)) {
    return { valid: false };
  }

  const normalizedReply = normalizeReplyText(value.replyText);
  if (
    !isResponseIntent(value.responseIntent) ||
    !isBookingIntent(value.bookingIntent) ||
    !isHandoffTrigger(value.handoffTrigger) ||
    !normalizedReply.valid
  ) {
    return { valid: false };
  }

  switch (value.responseIntent) {
    case "reply":
      return normalizedReply.text !== null &&
        value.bookingIntent === "none" &&
        value.handoffTrigger === "none"
        ? {
            valid: true,
            proposal: {
              responseIntent: value.responseIntent,
              replyText: normalizedReply.text,
              bookingIntent: value.bookingIntent,
              handoffTrigger: value.handoffTrigger,
            },
          }
        : { valid: false };
    case "booking_action_required":
      return normalizedReply.text === null &&
        value.bookingIntent !== "none" &&
        value.handoffTrigger === "none"
        ? {
            valid: true,
            proposal: {
              responseIntent: value.responseIntent,
              replyText: normalizedReply.text,
              bookingIntent: value.bookingIntent,
              handoffTrigger: value.handoffTrigger,
            },
          }
        : { valid: false };
    case "handoff_candidate":
      return value.bookingIntent === "none" &&
        value.handoffTrigger !== "none"
        ? {
            valid: true,
            proposal: {
              responseIntent: value.responseIntent,
              replyText: normalizedReply.text,
              bookingIntent: value.bookingIntent,
              handoffTrigger: value.handoffTrigger,
            },
          }
        : { valid: false };
    case "cannot_answer":
      return normalizedReply.text === null &&
        value.bookingIntent === "none" &&
        (value.handoffTrigger === "none" ||
          value.handoffTrigger === "ai_cannot_understand")
        ? {
            valid: true,
            proposal: {
              responseIntent: value.responseIntent,
              replyText: normalizedReply.text,
              bookingIntent: value.bookingIntent,
              handoffTrigger: value.handoffTrigger,
            },
          }
        : { valid: false };
  }
}

function toHandoffEvaluationContext(
  trigger: Exclude<ModelHandoffTrigger, "none">,
): HandoffEvaluationContext {
  switch (trigger) {
    case "custom_handoff_instruction":
      return { matched: true, trigger };
    case "ai_cannot_understand":
    case "customer_complaint":
    case "customer_requests_human":
    case "medical_question_or_contraindication":
    case "refund_or_payment_dispute":
      return { trigger };
  }
}

function handoffRuntimeDecision(
  decision: HandoffDecision,
): AiRuntimeDecision | null {
  if (!decision.shouldHandoff) return null;
  if (decision.reasonCode === null || decision.safeReason === null) {
    return { action: "no_safe_answer", reason: "model_invalid" };
  }

  return {
    action: "handoff",
    reasonCode: decision.reasonCode,
    safeReason: decision.safeReason,
  };
}

function evaluateHandoff(
  context: ConversationAiContext,
  trigger: Exclude<ModelHandoffTrigger, "none">,
): AiRuntimeDecision | null {
  return handoffRuntimeDecision(
    shouldHandoff(
      context.handoffPolicy,
      toHandoffEvaluationContext(trigger),
    ),
  );
}

function fallbackReplyOrNoAnswer(replyText: string | null): AiRuntimeDecision {
  return replyText === null
    ? { action: "no_safe_answer", reason: "model_cannot_answer" }
    : { action: "reply", text: replyText };
}

export function buildAiRuntimeDecision(
  context: ConversationAiContext,
  modelOutput: unknown,
): AiRuntimeDecision {
  const validation = validateModelProposal(modelOutput);
  if (!validation.valid) {
    return { action: "no_safe_answer", reason: "model_invalid" };
  }

  const { proposal } = validation;

  switch (proposal.responseIntent) {
    case "reply":
      return { action: "reply", text: proposal.replyText };
    case "booking_action_required":
      return {
        action: "booking_action_required",
        bookingIntent: proposal.bookingIntent,
      };
    case "handoff_candidate": {
      return (
        evaluateHandoff(context, proposal.handoffTrigger) ??
        fallbackReplyOrNoAnswer(proposal.replyText)
      );
    }
    case "cannot_answer": {
      if (proposal.handoffTrigger === "ai_cannot_understand") {
        const handoff = evaluateHandoff(context, proposal.handoffTrigger);
        if (handoff) return handoff;
      }
      return { action: "no_safe_answer", reason: "model_cannot_answer" };
    }
  }
}
