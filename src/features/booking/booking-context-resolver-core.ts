import type { CrmConnection, CrmProvider } from "../crm-connections/types";
import {
  createSafeBookingTools,
  type SafeBookingToolResult,
  type SafeBookingTools,
  type TrustedBookingExecutionContext,
} from "./safe-booking-tools-core.ts";

type BookingOperationsProvider = {
  readonly operations?: TrustedBookingExecutionContext["operations"];
};

export type BookingContextResolverDependencies = {
  loadConnections(
    organizationId: string,
  ): Promise<readonly CrmConnection[]>;
  getProvider(provider: CrmProvider): BookingOperationsProvider | undefined;
};

export type BookingContextResolutionResult =
  | {
      success: true;
      tools: SafeBookingTools;
    }
  | {
      success: false;
      code: Extract<
        Extract<SafeBookingToolResult<never>, { success: false }>["code"],
        | "connection_unavailable"
        | "provider_unavailable"
        | "operation_not_supported"
      >;
      retryable: false;
    };

function failure(
  code: Exclude<BookingContextResolutionResult, { success: true }>["code"],
): BookingContextResolutionResult {
  return { success: false, code, retryable: false };
}

function hasOwnProperty(
  value: object,
  property: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function normalizeLocationIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const locationIds = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.trim();
    if (normalized.length > 0) {
      locationIds.add(normalized);
    }
  }

  return [...locationIds];
}

function resolveLocationId(connection: CrmConnection): string | null {
  const configuration = connection.configuration;
  let candidates: readonly string[];

  if (hasOwnProperty(configuration, "verifiedLocationIds")) {
    candidates = normalizeLocationIds(configuration.verifiedLocationIds);
  } else if (hasOwnProperty(configuration, "activatedLocationIds")) {
    candidates = normalizeLocationIds(configuration.activatedLocationIds);
  } else {
    candidates = normalizeLocationIds(configuration.locationIds);
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export async function resolveSafeBookingToolsForOrganizationCore(
  organizationId: string,
  dependencies: BookingContextResolverDependencies,
): Promise<BookingContextResolutionResult> {
  let connections: readonly CrmConnection[];

  try {
    connections = await dependencies.loadConnections(organizationId);
  } catch {
    return failure("connection_unavailable");
  }

  const connectedConnections = connections.filter(
    (connection) =>
      connection.organizationId === organizationId &&
      connection.status === "connected",
  );

  if (connectedConnections.length !== 1) {
    return failure("connection_unavailable");
  }

  const connection = connectedConnections[0];
  let provider: BookingOperationsProvider | undefined;

  try {
    provider = dependencies.getProvider(connection.provider);
  } catch {
    return failure("provider_unavailable");
  }

  if (provider === undefined) {
    return failure("provider_unavailable");
  }

  const operations = provider.operations;
  if (operations === undefined) {
    return failure("operation_not_supported");
  }

  const locationId = resolveLocationId(connection);
  if (locationId === null) {
    return failure("connection_unavailable");
  }

  const context: TrustedBookingExecutionContext = {
    connection,
    locationId,
    operations,
  };

  return {
    success: true,
    tools: createSafeBookingTools(context),
  };
}
