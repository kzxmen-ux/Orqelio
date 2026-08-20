import "server-only";

import {
  createWhatsappInboxRepository,
  type WhatsappInboxClaimResult,
  type WhatsappInboxCompletionResult,
  type WhatsappInboxFailureResult,
  type WhatsappInboxRpc,
} from "./inbox-repository-core";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

const privilegedRpc: WhatsappInboxRpc = async (functionName, parameters) => {
  const { data, error } = await createPrivilegedClient().rpc(
    functionName,
    parameters,
  );

  return { data, error };
};

const repository = createWhatsappInboxRepository(privilegedRpc);

export function claimWhatsappWebhookEvent(
  eventId: string,
): Promise<WhatsappInboxClaimResult> {
  return repository.claimWhatsappWebhookEvent(eventId);
}

export function completeWhatsappWebhookEvent(
  eventId: string,
): Promise<WhatsappInboxCompletionResult> {
  return repository.completeWhatsappWebhookEvent(eventId);
}

export function failWhatsappWebhookEvent(
  eventId: string,
  errorCode: string,
): Promise<WhatsappInboxFailureResult> {
  return repository.failWhatsappWebhookEvent(eventId, errorCode);
}
