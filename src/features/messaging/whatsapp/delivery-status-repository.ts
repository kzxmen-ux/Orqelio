import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  applyWhatsappDeliveryStatusWithRpc,
  type WhatsappDeliveryStatusPersistenceInput,
  type WhatsappDeliveryStatusPersistenceResult,
} from "./delivery-status-repository-core";

export function applyWhatsappDeliveryStatus(
  input: WhatsappDeliveryStatusPersistenceInput,
): Promise<WhatsappDeliveryStatusPersistenceResult> {
  return applyWhatsappDeliveryStatusWithRpc(input, async (
    functionName,
    parameters,
  ) => {
    const supabase = createPrivilegedClient();
    const { data, error } = await supabase.rpc(functionName, parameters);
    return { data, error };
  });
}
