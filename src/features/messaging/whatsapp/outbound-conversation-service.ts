import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  recoverWhatsappOutboundDispatchWithDependencies,
  sendWhatsappConversationTextDurablyWithDependencies,
  type RecoverWhatsappOutboundDispatchInput,
  type WhatsappDurableOutboundConversationResult,
  type WhatsappOutboundConversationInput,
} from "./outbound-conversation-service-core";
import {
  finalizeWhatsappOutboundDispatch,
  getWhatsappOutboundDispatchRecoveryState,
  markWhatsappOutboundDispatchIndeterminate,
  markWhatsappOutboundDispatching,
  prepareWhatsappOutboundDispatch,
  recordWhatsappOutboundProviderAcceptance,
} from "./outbound-dispatch-repository";
import { sendWhatsappTextMessage } from "./outbound-text-sender";

const waitBeforeDatabaseRetry = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, attempt * 50));

export function sendWhatsappConversationText(
  input: WhatsappOutboundConversationInput,
): Promise<WhatsappDurableOutboundConversationResult> {
  return sendWhatsappConversationTextDurablyWithDependencies(input, {
    lookupConversation: async (validatedInput) => {
      const supabase = createPrivilegedClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(
          `
            id,
            organization_id,
            channel,
            external_participant_id,
            connection:whatsapp_channel_connections!conversations_channel_connection_id_fkey (
              id,
              organization_id,
              status,
              phone_number_id
            )
          `,
        )
        .eq("id", validatedInput.conversationId)
        .eq("organization_id", validatedInput.organizationId)
        .limit(2);

      return { data, error };
    },
    finalizeDispatch: finalizeWhatsappOutboundDispatch,
    markDispatching: markWhatsappOutboundDispatching,
    markIndeterminate: markWhatsappOutboundDispatchIndeterminate,
    prepareDispatch: prepareWhatsappOutboundDispatch,
    recordProviderAcceptance: recordWhatsappOutboundProviderAcceptance,
    sendTextMessage: sendWhatsappTextMessage,
    waitBeforeRetry: waitBeforeDatabaseRetry,
  });
}

export function recoverWhatsappOutboundDispatch(
  input: RecoverWhatsappOutboundDispatchInput,
): Promise<WhatsappDurableOutboundConversationResult> {
  return recoverWhatsappOutboundDispatchWithDependencies(input, {
    finalizeDispatch: finalizeWhatsappOutboundDispatch,
    getRecoveryState: getWhatsappOutboundDispatchRecoveryState,
    recordProviderAcceptance: recordWhatsappOutboundProviderAcceptance,
    waitBeforeRetry: waitBeforeDatabaseRetry,
  });
}
