import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  storeWhatsappOutboundMessageWithRpc,
  type WhatsappOutboundMessagePersistenceInput,
  type WhatsappOutboundMessageStoreResult,
} from "./outbound-message-repository-core";

export function storeWhatsappOutboundMessage(
  input: WhatsappOutboundMessagePersistenceInput,
): Promise<WhatsappOutboundMessageStoreResult> {
  return storeWhatsappOutboundMessageWithRpc(input, async (validatedInput) => {
    const supabase = createPrivilegedClient();
    const { data, error } = await supabase.rpc(
      "store_whatsapp_outbound_message",
      {
        p_connection_id: validatedInput.connectionId,
        p_conversation_id: validatedInput.conversationId,
        p_organization_id: validatedInput.organizationId,
        p_provider_message_id: validatedInput.providerMessageId,
        p_text_content: validatedInput.textContent,
      },
    );

    return { data, error };
  });
}
