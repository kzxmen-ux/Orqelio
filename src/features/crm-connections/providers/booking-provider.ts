import "server-only";

import type {
  CrmConnection,
  CrmProvider,
} from "../types";
import type { BookingProviderOperations } from "./booking-operations";

export type BookingProviderCredentialValidation =
  | {
      data: Readonly<Record<string, string>>;
      success: true;
    }
  | {
      fieldErrors: Record<string, string[] | undefined>;
      success: false;
    };

export type BookingProviderConnectionMetadata = {
  companyId: string | null;
  configurationMode: "encrypted_credentials" | "non_secret";
  credentialsSaved: boolean;
  credentialsUpdatedAt: string | null;
  provider: CrmProvider;
  providerLabel: string;
  settingsDescription: string;
};

export type BookingProviderConnectionTestResult =
  | {
      status: "api_access_required";
    }
  | {
      status: "credentials_required";
    }
  | {
      status: "provider_unavailable";
    };

export type BookingProviderMetadataOptions = {
  includeCredentialStatus?: boolean;
};

export interface BookingProvider {
  operations?: BookingProviderOperations;

  disconnect(): { status: "disconnected" };

  getConnectionMetadata(
    connection: CrmConnection,
    options?: BookingProviderMetadataOptions,
  ): Promise<BookingProviderConnectionMetadata | null>;

  testConnection(input: {
    credentialsSaved: boolean;
  }): BookingProviderConnectionTestResult;

  validateCredentials(input: unknown): BookingProviderCredentialValidation;
}
