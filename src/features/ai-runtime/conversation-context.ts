import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  loadConversationAiContextWithDependencies,
  type ConversationAiContextInput,
  type ConversationAiContextResult,
} from "./conversation-context-core";

const configurationColumns = `organization_id, primary_language, formality,
  communication_style, raw_business_context, status, version,
  handoff_client_requests_admin, handoff_ai_uncertain, handoff_booking_error,
  handoff_customer_complaint, handoff_medical_question,
  handoff_payment_dispute, handoff_other_cases`;

export function loadConversationAiContext(
  input: ConversationAiContextInput,
): Promise<ConversationAiContextResult> {
  const supabase = createPrivilegedClient();

  return loadConversationAiContextWithDependencies(input, {
    loadOrganization: async ({ organizationId }) => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("id", organizationId)
        .limit(2);
      return { data, error };
    },
    loadConversation: async ({ conversationId, organizationId }) => {
      const { data, error } = await supabase
        .from("conversations")
        .select(
          `
            id,
            organization_id,
            channel,
            connection:whatsapp_channel_connections!conversations_channel_connection_id_fkey (
              id,
              organization_id,
              status
            )
          `,
        )
        .eq("id", conversationId)
        .eq("organization_id", organizationId)
        .eq("channel", "whatsapp")
        .limit(2);
      return { data, error };
    },
    loadTriggerMessage: async ({
      conversationId,
      organizationId,
      triggerMessageId,
    }) => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, organization_id, conversation_id, channel, direction, message_type, text_content, created_at",
        )
        .eq("id", triggerMessageId)
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .eq("channel", "whatsapp")
        .eq("direction", "inbound")
        .eq("message_type", "text")
        .not("text_content", "is", null)
        .limit(2);
      return { data, error };
    },
    loadAiManagerConfiguration: async ({ organizationId }) => {
      const { data, error } = await supabase
        .from("ai_manager_configurations")
        .select(configurationColumns)
        .eq("organization_id", organizationId)
        .limit(2);
      return { data, error };
    },
    loadRecentMessages: async ({
      conversationId,
      organizationId,
      triggerCreatedAt,
    }) => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, text_content, created_at, delivery_status")
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .eq("channel", "whatsapp")
        .eq("message_type", "text")
        .not("text_content", "is", null)
        .neq("delivery_status", "failed")
        .lte("created_at", triggerCreatedAt)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(30);
      return { data, error };
    },
  });
}
