import "server-only";

import { z } from "zod";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

const storeResultRowsSchema = z.array(
  z.object({
    event_id: z.uuid(),
    outcome: z.enum(["accepted", "duplicate"]),
  }),
);

export interface WhatsappWebhookStoreResult {
  eventId: string;
  outcome: "accepted" | "duplicate";
}

export async function storeWhatsappWebhookEvent(
  payload: Record<string, unknown>,
): Promise<WhatsappWebhookStoreResult> {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase.rpc(
    "store_whatsapp_webhook_event",
    { p_payload: payload },
  );

  if (error) {
    throw new Error("WhatsApp webhook storage failed.");
  }

  const rows = storeResultRowsSchema.safeParse(data);

  if (!rows.success || rows.data.length !== 1) {
    throw new Error("WhatsApp webhook storage failed.");
  }

  const result = rows.data[0];

  return { eventId: result.event_id, outcome: result.outcome };
}
