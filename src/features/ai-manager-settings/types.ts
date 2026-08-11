export type AiManagerPrimaryLanguage = "kk" | "ru";
export type AiManagerFormality = "formal" | "informal";
export type AiManagerCommunicationStyle = "formal" | "friendly" | "neutral";
export type AiManagerConfigurationStatus = "draft" | "ready";

export type AiManagerHandoffSettings = {
  aiUncertain: boolean;
  bookingError: boolean;
  clientRequestsAdmin: boolean;
  customerComplaint: boolean;
  medicalQuestion: boolean;
  otherCases: string;
  paymentDispute: boolean;
};

export type AiManagerConfiguration = {
  communicationStyle: AiManagerCommunicationStyle;
  createdAt: string;
  formality: AiManagerFormality;
  handoff: AiManagerHandoffSettings;
  organizationId: string;
  primaryLanguage: AiManagerPrimaryLanguage;
  rawBusinessContext: string;
  status: AiManagerConfigurationStatus;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type AiManagerConfigurationVersion = Omit<
  AiManagerConfiguration,
  "createdAt" | "updatedAt" | "updatedBy"
> & {
  createdAt: string;
  createdBy: string;
};

export type AiManagerWarningCode =
  | "address_missing"
  | "cancellation_rules_missing"
  | "handoff_rules_missing"
  | "payment_methods_missing";

export type AiManagerActionState = {
  fieldErrors?: Record<string, string[] | undefined>;
  message?: string;
  savedStatus?: AiManagerConfigurationStatus;
  savedVersion?: number;
  status: "error" | "idle" | "success";
  warnings?: AiManagerWarningCode[];
};
