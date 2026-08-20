import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import type { RoutedWhatsappInboundMessage } from "./inbound-routing-core";
import {
  storeRoutedWhatsappInboundMessageWithRpc,
  type WhatsappInboundStoreResult,
} from "./inbound-message-repository-core";

export async function storeRoutedWhatsappInboundMessage(
  message: RoutedWhatsappInboundMessage,
): Promise<WhatsappInboundStoreResult> {
  return storeRoutedWhatsappInboundMessageWithRpc(message, async (input) => {
    const supabase = createPrivilegedClient();
    const { data, error } = await supabase.rpc(
      "store_whatsapp_inbound_message",
      {
        p_connection_id: input.connectionId,
        p_display_name: input.displayName,
        p_external_participant_id: input.externalParticipantId,
        p_message_type: input.messageType,
        p_organization_id: input.organizationId,
        p_phone_number_id: input.phoneNumberId,
        p_provider_message_id: input.providerMessageId,
        p_provider_timestamp: input.providerTimestamp,
        p_sender_external_id: input.senderExternalId,
        p_text_content: input.textContent,
        p_waba_id: input.wabaId,
      },
    );

    return { data, error };
  });
}
