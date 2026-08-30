import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { isBookingAutomationAllowedWithRpc } from "./booking-automation-gate-core";

export function isBookingAutomationAllowed(input: { organizationId: string; aiMessageRunId: string }) {
  return isBookingAutomationAllowedWithRpc(input, async (name, parameters) => {
    const { data, error } = await createPrivilegedClient().rpc(name, parameters);
    return { data, error };
  });
}
