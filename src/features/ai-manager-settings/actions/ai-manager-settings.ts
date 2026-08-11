"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

import type { AiManagerActionState } from "../types";
import {
  aiManagerSettingsSchema,
  formString,
  getAiManagerWarnings,
  restoreAiManagerSettingsSchema,
} from "../validation/ai-manager-settings";

type RpcResult = {
  changed: boolean;
  saved_at: string;
  saved_status: "draft" | "ready";
  saved_version: number;
};

function paths(organizationId: string) {
  revalidatePath(`/app/organizations/${organizationId}`);
  revalidatePath(`/app/organizations/${organizationId}/ai-manager`);
}

function safeRpcError(code?: string): AiManagerActionState {
  return {
    message:
      code === "40001"
        ? "Settings changed in another session. Refresh and try again."
        : "AI manager settings could not be saved. Try again.",
    status: "error",
  };
}

export async function saveAiManagerSettingsAction(
  _previousState: AiManagerActionState,
  formData: FormData,
): Promise<AiManagerActionState> {
  const validation = aiManagerSettingsSchema.safeParse({
    communicationStyle: formString(formData, "communicationStyle"),
    expectedVersion: formString(formData, "expectedVersion"),
    formality: formString(formData, "formality"),
    handoffAiUncertain: formData.get("handoffAiUncertain"),
    handoffBookingError: formData.get("handoffBookingError"),
    handoffClientRequestsAdmin: formData.get("handoffClientRequestsAdmin"),
    handoffCustomerComplaint: formData.get("handoffCustomerComplaint"),
    handoffMedicalQuestion: formData.get("handoffMedicalQuestion"),
    handoffOtherCases: formString(formData, "handoffOtherCases"),
    handoffPaymentDispute: formData.get("handoffPaymentDispute"),
    organizationId: formString(formData, "organizationId"),
    primaryLanguage: formString(formData, "primaryLanguage"),
    rawBusinessContext: formString(formData, "rawBusinessContext"),
  });

  if (!validation.success) {
    return {
      fieldErrors: validation.error.flatten().fieldErrors,
      message: "Check the highlighted fields.",
      status: "error",
    };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (!authData.user || authError) {
    return { message: "Your session has expired. Sign in and try again.", status: "error" };
  }

  const input = validation.data;
  const handoff = {
    aiUncertain: input.handoffAiUncertain,
    bookingError: input.handoffBookingError,
    clientRequestsAdmin: input.handoffClientRequestsAdmin,
    customerComplaint: input.handoffCustomerComplaint,
    medicalQuestion: input.handoffMedicalQuestion,
    otherCases: input.handoffOtherCases,
    paymentDispute: input.handoffPaymentDispute,
  };
  const warnings = getAiManagerWarnings({
    handoff,
    rawBusinessContext: input.rawBusinessContext,
  });
  const { data, error } = await supabase.rpc("save_ai_manager_configuration", {
    p_communication_style: input.communicationStyle,
    p_expected_version: input.expectedVersion,
    p_formality: input.formality,
    p_handoff_ai_uncertain: handoff.aiUncertain,
    p_handoff_booking_error: handoff.bookingError,
    p_handoff_client_requests_admin: handoff.clientRequestsAdmin,
    p_handoff_customer_complaint: handoff.customerComplaint,
    p_handoff_medical_question: handoff.medicalQuestion,
    p_handoff_other_cases: handoff.otherCases,
    p_handoff_payment_dispute: handoff.paymentDispute,
    p_organization_id: input.organizationId,
    p_primary_language: input.primaryLanguage,
    p_raw_business_context: input.rawBusinessContext,
  });

  if (error || !Array.isArray(data) || !data[0]) {
    return safeRpcError(error?.code);
  }

  const result = data[0] as RpcResult;
  paths(input.organizationId);
  return {
    message: result.changed
      ? "AI manager settings saved."
      : "AI manager settings have not changed.",
    savedStatus: result.saved_status,
    savedVersion: result.saved_version,
    status: "success",
    warnings,
  };
}

export async function restoreAiManagerSettingsAction(
  _previousState: AiManagerActionState,
  formData: FormData,
): Promise<AiManagerActionState> {
  const validation = restoreAiManagerSettingsSchema.safeParse({
    expectedVersion: formString(formData, "expectedVersion"),
    organizationId: formString(formData, "organizationId"),
    version: formString(formData, "version"),
  });
  if (!validation.success) {
    return { message: "Invalid configuration version.", status: "error" };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (!authData.user || authError) {
    return { message: "Your session has expired. Sign in and try again.", status: "error" };
  }

  const input = validation.data;
  const { data, error } = await supabase.rpc("restore_ai_manager_configuration", {
    p_expected_version: input.expectedVersion,
    p_organization_id: input.organizationId,
    p_version: input.version,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    return safeRpcError(error?.code);
  }

  const result = data[0] as RpcResult;
  paths(input.organizationId);
  return {
    message: "AI manager settings version restored.",
    savedStatus: result.saved_status,
    savedVersion: result.saved_version,
    status: "success",
  };
}
