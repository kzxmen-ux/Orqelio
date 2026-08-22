import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  sendWhatsappConversationTextWithDependencies,
  type WhatsappOutboundConversationInput,
  type WhatsappOutboundConversationResult,
} from "./outbound-conversation-service-core";
import { storeWhatsappOutboundMessage } from "./outbound-message-repository";
import { sendWhatsappTextMessage } from "./outbound-text-sender";

export function sendWhatsappConversationText(
  input: WhatsappOutboundConversationInput,
): Promise<WhatsappOutboundConversationResult> {
  return sendWhatsappConversationTextWithDependencies(input, {
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
    sendTextMessage: sendWhatsappTextMessage,
    storeOutboundMessage: storeWhatsappOutboundMessage,
  });
}
