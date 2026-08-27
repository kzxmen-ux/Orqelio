import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  claimAiReplyWhatsappDispatchExecutionWithRpc,
  finalizeWhatsappOutboundDispatchWithRpc,
  getWhatsappOutboundDispatchRecoveryStateWithRpc,
  markWhatsappOutboundDispatchIndeterminateWithRpc,
  markWhatsappOutboundDispatchingWithRpc,
  prepareAiReplyWhatsappDispatchWithRpc,
  prepareWhatsappOutboundDispatchWithRpc,
  quarantineStaleAiReplyWhatsappDispatchesWithRpc,
  recordWhatsappOutboundProviderAcceptanceWithRpc,
  type ClaimAiReplyWhatsappDispatchExecutionInput,
  type ClaimAiReplyWhatsappDispatchExecutionResult,
  type PrepareAiReplyWhatsappDispatchInput,
  type PrepareWhatsappOutboundDispatchInput,
  type PreparedWhatsappOutboundDispatchResult,
  type QuarantineStaleAiReplyWhatsappDispatchesResult,
  type RecordWhatsappProviderAcceptanceInput,
  type WhatsappOutboundDispatchFinalizationResult,
  type WhatsappOutboundDispatchIdentity,
  type WhatsappOutboundDispatchRecoveryState,
  type WhatsappOutboundDispatchResult,
  type WhatsappOutboundDispatchRpc,
} from "./outbound-dispatch-repository-core";

const rpc: WhatsappOutboundDispatchRpc = async (functionName, parameters) => {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase.rpc(functionName, parameters);
  return { data, error };
};

export function prepareWhatsappOutboundDispatch(
  input: PrepareWhatsappOutboundDispatchInput,
): Promise<PreparedWhatsappOutboundDispatchResult> {
  return prepareWhatsappOutboundDispatchWithRpc(input, rpc);
}

export function prepareAiReplyWhatsappDispatch(
  input: PrepareAiReplyWhatsappDispatchInput,
): Promise<WhatsappOutboundDispatchResult> {
  return prepareAiReplyWhatsappDispatchWithRpc(input, rpc);
}

export function claimAiReplyWhatsappDispatchExecution(
  input: ClaimAiReplyWhatsappDispatchExecutionInput,
): Promise<ClaimAiReplyWhatsappDispatchExecutionResult> {
  return claimAiReplyWhatsappDispatchExecutionWithRpc(input, rpc);
}

export function quarantineStaleAiReplyWhatsappDispatches(
  limit?: number,
): Promise<QuarantineStaleAiReplyWhatsappDispatchesResult> {
  return quarantineStaleAiReplyWhatsappDispatchesWithRpc(limit, rpc);
}

export function getWhatsappOutboundDispatchRecoveryState(
  input: WhatsappOutboundDispatchIdentity,
): Promise<WhatsappOutboundDispatchRecoveryState> {
  return getWhatsappOutboundDispatchRecoveryStateWithRpc(input, rpc);
}

export function markWhatsappOutboundDispatching(
  input: WhatsappOutboundDispatchIdentity,
): Promise<WhatsappOutboundDispatchResult> {
  return markWhatsappOutboundDispatchingWithRpc(input, rpc);
}

export function recordWhatsappOutboundProviderAcceptance(
  input: RecordWhatsappProviderAcceptanceInput,
): Promise<WhatsappOutboundDispatchResult> {
  return recordWhatsappOutboundProviderAcceptanceWithRpc(input, rpc);
}

export function markWhatsappOutboundDispatchIndeterminate(
  input: WhatsappOutboundDispatchIdentity,
): Promise<WhatsappOutboundDispatchResult> {
  return markWhatsappOutboundDispatchIndeterminateWithRpc(input, rpc);
}

export function finalizeWhatsappOutboundDispatch(
  input: WhatsappOutboundDispatchIdentity,
): Promise<WhatsappOutboundDispatchFinalizationResult> {
  return finalizeWhatsappOutboundDispatchWithRpc(input, rpc);
}
