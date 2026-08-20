import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  resolveWhatsappConnectionWithQuery,
  type ResolvedWhatsappConnection,
  type WhatsappConnectionInput,
} from "./connection-repository-core";

export async function resolveWhatsappConnection(
  input: WhatsappConnectionInput,
): Promise<ResolvedWhatsappConnection | null> {
  return resolveWhatsappConnectionWithQuery(input, async (validatedInput) => {
    const supabase = createPrivilegedClient();
    const { data, error } = await supabase
      .from("whatsapp_channel_connections")
      .select("id, organization_id, status")
      .eq("waba_id", validatedInput.wabaId)
      .eq("phone_number_id", validatedInput.phoneNumberId)
      .eq("status", "active")
      .limit(2);

    return { data, error };
  });
}
