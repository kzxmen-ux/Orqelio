import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";

import {
  claimBookingMutationExecutionWithRpc,
  markBookingMutationIndeterminateWithRpc,
  prepareBookingMutationExecutionWithRpc,
  quarantineStaleBookingMutationExecutionsWithRpc,
  recordBookingMutationFailureWithRpc,
  recordBookingMutationSuccessWithRpc,
  type BookingMutationExecutionIdentity,
  type BookingMutationExecutionRpc,
  type BookingMutationTerminalResult,
  type BookingMutationTerminalStoreResult,
  type ClaimBookingMutationExecutionResult,
  type PrepareBookingMutationExecutionInput,
  type PrepareBookingMutationExecutionResult,
  type QuarantineStaleBookingMutationExecutionsResult,
} from "./booking-mutation-execution-repository-core";

const rpc: BookingMutationExecutionRpc = async (functionName, parameters) => {
  const supabase = createPrivilegedClient();
  const { data, error } = await supabase.rpc(functionName, parameters);
  return { data, error };
};

export function prepareBookingMutationExecution(
  input: PrepareBookingMutationExecutionInput,
): Promise<PrepareBookingMutationExecutionResult> {
  return prepareBookingMutationExecutionWithRpc(input, rpc);
}

export function claimBookingMutationExecution(
  organizationId: string,
  aiMessageRunId: string,
): Promise<ClaimBookingMutationExecutionResult> {
  return claimBookingMutationExecutionWithRpc(
    organizationId,
    aiMessageRunId,
    rpc,
  );
}

export function recordBookingMutationSuccess(
  input: BookingMutationExecutionIdentity,
  result: Extract<BookingMutationTerminalResult, { success: true }>,
): Promise<BookingMutationTerminalStoreResult> {
  return recordBookingMutationSuccessWithRpc(input, result, rpc);
}

export function recordBookingMutationFailure(
  input: BookingMutationExecutionIdentity,
  result: Extract<BookingMutationTerminalResult, { success: false }>,
): Promise<BookingMutationTerminalStoreResult> {
  return recordBookingMutationFailureWithRpc(input, result, rpc);
}

export function markBookingMutationIndeterminate(
  input: BookingMutationExecutionIdentity,
): Promise<BookingMutationTerminalStoreResult> {
  return markBookingMutationIndeterminateWithRpc(input, rpc);
}

export function quarantineStaleBookingMutationExecutions(
  limit?: number,
): Promise<QuarantineStaleBookingMutationExecutionsResult> {
  return quarantineStaleBookingMutationExecutionsWithRpc(limit, rpc);
}

export type {
  BookingMutationExecutionIdentity,
  BookingMutationExecutionState,
  BookingMutationTerminalResult,
  BookingMutationTerminalStoreResult,
  ClaimBookingMutationExecutionResult,
  PrepareBookingMutationExecutionInput,
  PrepareBookingMutationExecutionResult,
  QuarantineStaleBookingMutationExecutionsResult,
  TrustedCreateAppointmentRequest,
} from "./booking-mutation-execution-repository-core";
