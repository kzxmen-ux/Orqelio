type GateRpc = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// DB evaluates the organization's activation against the bound run.created_at.
// Caller-supplied dates, AI output and device time cannot open the gate.
export async function isBookingAutomationAllowedWithRpc(
  input: { organizationId: string; aiMessageRunId: string },
  rpc: GateRpc,
): Promise<boolean> {
  if (!UUID_PATTERN.test(input.organizationId) || !UUID_PATTERN.test(input.aiMessageRunId)) return false;
  try {
    const { data, error } = await rpc("booking_automation_allows_run", {
      p_organization_id: input.organizationId,
      p_ai_message_run_id: input.aiMessageRunId,
    });
    return error === null && data === true;
  } catch {
    return false;
  }
}
