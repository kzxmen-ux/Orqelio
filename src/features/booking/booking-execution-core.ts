import type { BookingContextResolutionResult } from "./booking-context-resolver-core";
import type {
  BookingOrchestratorInput,
  BookingOrchestratorResult,
} from "./booking-orchestrator-core";
import type { SafeBookingTools } from "./safe-booking-tools-core";

type BookingContextResolutionFailure = Extract<
  BookingContextResolutionResult,
  { success: false }
>;

export type BookingExecutionInput = {
  organizationId: string;
  request: BookingOrchestratorInput;
};

export type BookingExecutionResult =
  | BookingOrchestratorResult
  | {
      status: "unavailable";
      code: BookingContextResolutionFailure["code"] | "provider_error";
      retryable: boolean;
    };

export type BookingExecutionDependencies = {
  resolveSafeBookingToolsForOrganization(
    organizationId: string,
  ): Promise<BookingContextResolutionResult>;
  executeBookingOrchestrator(
    request: BookingOrchestratorInput,
    tools: SafeBookingTools,
  ): Promise<BookingOrchestratorResult>;
};

function providerError(): BookingExecutionResult {
  return {
    status: "unavailable",
    code: "provider_error",
    retryable: false,
  };
}

export async function executeBookingForOrganizationCore(
  input: BookingExecutionInput,
  dependencies: BookingExecutionDependencies,
): Promise<BookingExecutionResult> {
  try {
    const resolution =
      await dependencies.resolveSafeBookingToolsForOrganization(
        input.organizationId,
      );

    if (!resolution.success) {
      return {
        status: "unavailable",
        code: resolution.code,
        retryable: resolution.retryable,
      };
    }

    return await dependencies.executeBookingOrchestrator(
      input.request,
      resolution.tools,
    );
  } catch {
    return providerError();
  }
}
