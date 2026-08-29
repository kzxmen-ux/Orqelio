import "server-only";

import { resolveSafeBookingToolsForOrganization } from "./booking-context-resolver";
import {
  executeBookingForOrganizationCore,
  type BookingExecutionInput,
  type BookingExecutionResult,
} from "./booking-execution-core";
import { executeBookingOrchestrator } from "./booking-orchestrator-core";

export async function executeBookingForOrganization(
  input: BookingExecutionInput,
): Promise<BookingExecutionResult> {
  return executeBookingForOrganizationCore(input, {
    resolveSafeBookingToolsForOrganization,
    executeBookingOrchestrator,
  });
}

export type {
  BookingExecutionInput,
  BookingExecutionResult,
} from "./booking-execution-core";
