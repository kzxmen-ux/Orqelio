import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  AiManagerConfiguration,
  AiManagerConfigurationVersion,
} from "../types";

type CurrentRow = {
  communication_style: AiManagerConfiguration["communicationStyle"];
  created_at: string;
  formality: AiManagerConfiguration["formality"];
  handoff_ai_uncertain: boolean;
  handoff_booking_error: boolean;
  handoff_client_requests_admin: boolean;
  handoff_customer_complaint: boolean;
  handoff_medical_question: boolean;
  handoff_other_cases: string;
  handoff_payment_dispute: boolean;
  organization_id: string;
  primary_language: AiManagerConfiguration["primaryLanguage"];
  raw_business_context: string;
  status: AiManagerConfiguration["status"];
  updated_at: string;
  updated_by: string;
  version: number;
};

type VersionRow = Omit<CurrentRow, "updated_at" | "updated_by"> & {
  created_by: string;
};

const currentColumns = `organization_id, primary_language, formality,
  communication_style, raw_business_context, status, version,
  handoff_client_requests_admin, handoff_ai_uncertain, handoff_booking_error,
  handoff_customer_complaint, handoff_medical_question,
  handoff_payment_dispute, handoff_other_cases, updated_by, created_at,
  updated_at`;

const versionColumns = `organization_id, primary_language, formality,
  communication_style, raw_business_context, status, version,
  handoff_client_requests_admin, handoff_ai_uncertain, handoff_booking_error,
  handoff_customer_complaint, handoff_medical_question,
  handoff_payment_dispute, handoff_other_cases, created_by, created_at`;

function mapHandoff(row: CurrentRow | VersionRow) {
  return {
    aiUncertain: row.handoff_ai_uncertain,
    bookingError: row.handoff_booking_error,
    clientRequestsAdmin: row.handoff_client_requests_admin,
    customerComplaint: row.handoff_customer_complaint,
    medicalQuestion: row.handoff_medical_question,
    otherCases: row.handoff_other_cases,
    paymentDispute: row.handoff_payment_dispute,
  };
}

function mapCurrent(row: CurrentRow): AiManagerConfiguration {
  return {
    communicationStyle: row.communication_style,
    createdAt: row.created_at,
    formality: row.formality,
    handoff: mapHandoff(row),
    organizationId: row.organization_id,
    primaryLanguage: row.primary_language,
    rawBusinessContext: row.raw_business_context,
    status: row.status,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: row.version,
  };
}

function mapVersion(row: VersionRow): AiManagerConfigurationVersion {
  return {
    communicationStyle: row.communication_style,
    createdAt: row.created_at,
    createdBy: row.created_by,
    formality: row.formality,
    handoff: mapHandoff(row),
    organizationId: row.organization_id,
    primaryLanguage: row.primary_language,
    rawBusinessContext: row.raw_business_context,
    status: row.status,
    version: row.version,
  };
}

export async function getAiManagerConfiguration(
  organizationId: string,
): Promise<AiManagerConfiguration | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_manager_configurations")
    .select(currentColumns)
    .eq("organization_id", organizationId)
    .maybeSingle<CurrentRow>();

  return !data || error ? null : mapCurrent(data);
}

export async function listAiManagerConfigurationVersions(
  organizationId: string,
): Promise<AiManagerConfigurationVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_manager_configuration_versions")
    .select(versionColumns)
    .eq("organization_id", organizationId)
    .order("version", { ascending: false })
    .limit(20)
    .returns<VersionRow[]>();

  return !data || error ? [] : data.map(mapVersion);
}

export async function getAiManagerSettingsPageData(organizationId: string) {
  const supabase = await createClient();
  const [{ data: authData }, configuration, versions] = await Promise.all([
    supabase.auth.getUser(),
    getAiManagerConfiguration(organizationId),
    listAiManagerConfigurationVersions(organizationId),
  ]);

  return { configuration, currentUserId: authData.user?.id ?? null, versions };
}
