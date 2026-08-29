import "server-only";

import type {
  BookingProvider,
  BookingProviderConnectionMetadata,
  BookingProviderCredentialValidation,
} from "../booking-provider";
import type { BookingProviderOperations } from "../booking-operations";
import { developmentBookingOperations } from "./development-booking-operations-core";

export class DevelopmentProvider implements BookingProvider {
  readonly operations: BookingProviderOperations = developmentBookingOperations;

  disconnect(): { status: "disconnected" } {
    return { status: "disconnected" };
  }

  async getConnectionMetadata(): Promise<BookingProviderConnectionMetadata> {
    return {
      companyId: null,
      configurationMode: "non_secret",
      credentialsSaved: false,
      credentialsUpdatedAt: null,
      provider: "custom",
      providerLabel: "Development connection",
      settingsDescription:
        "Only controlled, non-secret placeholder configuration is stored.",
    };
  }

  testConnection(): { status: "provider_unavailable" } {
    return { status: "provider_unavailable" };
  }

  validateCredentials(): BookingProviderCredentialValidation {
    return { data: {}, success: true };
  }
}
