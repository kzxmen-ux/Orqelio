import { z } from "zod";

import type {
  CrmConnection,
  CrmConnectionConfiguration,
} from "../crm-connections/types";

const databaseConfigurationSchema = z
  .object({
    activated_location_ids: z.array(z.string()).optional(),
    activation_completed_at: z.string().optional(),
    application_id: z.string().optional(),
    location_ids: z.array(z.string()).optional(),
    provider_activation_status: z
      .enum(["error", "partial", "verified"])
      .optional(),
    region: z.enum(["global", "eu", "us", "apac"]).optional(),
    salon_id: z.string().optional(),
    verified_location_ids: z.array(z.string()).optional(),
    workspace_reference: z.string().optional(),
  })
  .strip();

const crmConnectionRowsSchema = z.array(
  z
    .object({
      configuration: databaseConfigurationSchema,
      created_at: z.string(),
      display_name: z.string(),
      id: z.uuid(),
      last_sync_at: z.string().nullable(),
      organization_id: z.uuid(),
      provider: z.enum(["altegio", "custom", "yclients"]),
      status: z.enum(["draft", "connected", "disconnected", "error"]),
      updated_at: z.string(),
    })
    .strict(),
);

function mapConfiguration(
  configuration: z.infer<typeof databaseConfigurationSchema>,
): CrmConnectionConfiguration {
  return {
    ...(configuration.activated_location_ids !== undefined
      ? { activatedLocationIds: configuration.activated_location_ids }
      : {}),
    ...(configuration.activation_completed_at !== undefined
      ? { activationCompletedAt: configuration.activation_completed_at }
      : {}),
    ...(configuration.application_id !== undefined
      ? { applicationId: configuration.application_id }
      : {}),
    ...(configuration.location_ids !== undefined
      ? { locationIds: configuration.location_ids }
      : {}),
    ...(configuration.provider_activation_status !== undefined
      ? {
          providerActivationStatus:
            configuration.provider_activation_status,
        }
      : {}),
    ...(configuration.region !== undefined
      ? { region: configuration.region }
      : {}),
    ...(configuration.salon_id !== undefined
      ? { salonId: configuration.salon_id }
      : {}),
    ...(configuration.verified_location_ids !== undefined
      ? { verifiedLocationIds: configuration.verified_location_ids }
      : {}),
    ...(configuration.workspace_reference !== undefined
      ? { workspaceReference: configuration.workspace_reference }
      : {}),
  };
}

function mapConnection(
  row: z.infer<typeof crmConnectionRowsSchema>[number],
): CrmConnection {
  return {
    configuration: mapConfiguration(row.configuration),
    createdAt: row.created_at,
    displayName: row.display_name,
    id: row.id,
    lastSyncAt: row.last_sync_at,
    organizationId: row.organization_id,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function parseBookingCrmConnectionRows(
  value: unknown,
): readonly CrmConnection[] | null {
  const parsedRows = crmConnectionRowsSchema.safeParse(value);
  return parsedRows.success ? parsedRows.data.map(mapConnection) : null;
}
