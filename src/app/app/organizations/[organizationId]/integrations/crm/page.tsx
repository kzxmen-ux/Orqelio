import Link from "next/link";
import { notFound } from "next/navigation";

import { AltegioMarketplaceConnectButton } from "@/features/crm-connections/components/altegio-marketplace-connect-button";
import { CrmProviderCard } from "@/features/crm-connections/components/crm-provider-card";
import { getBookingProvider } from "@/features/crm-connections/providers/booking-provider-registry";
import { listCrmConnections } from "@/features/crm-connections/queries/crm-connections";
import type { CrmConnectionStatus } from "@/features/crm-connections/types";
import { integrationStatusLabel } from "@/features/integration-status/presentation";
import { listAltegioIntegrationAttempts } from "@/features/integration-status/queries/altegio-status";
import { resolveAltegioStatusCenter } from "@/features/integration-status/status-center";
import { OrganizationWorkspaceNavigation } from "@/features/organizations/components/organization-workspace-navigation";
import { getOrganizationForCurrentUser } from "@/features/organizations/queries/organizations";
import { organizationIdSchema } from "@/features/organizations/validation/organization";
import { getLocale, getTranslator } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type CrmConnectionsPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
  searchParams: Promise<{
    deleted?: string;
  }>;
};

function formatLastSync(
  value: string | null,
  locale: string,
  neverLabel: string,
): string {
  if (!value) {
    return neverLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusClass(status: CrmConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-emerald-50 text-emerald-700";
    case "error":
      return "bg-rose-50 text-rose-700";
    case "disconnected":
      return "bg-slate-100 text-slate-600";
    case "draft":
      return "bg-amber-50 text-amber-700";
  }
}

export default async function CrmConnectionsPage({
  params,
  searchParams,
}: CrmConnectionsPageProps) {
  const [{ organizationId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedOrganizationId = organizationIdSchema.safeParse(organizationId);

  if (!parsedOrganizationId.success) {
    notFound();
  }

  const organization = await getOrganizationForCurrentUser(
    parsedOrganizationId.data,
  );

  if (!organization) {
    notFound();
  }

  const [connections, attemptResult, locale, t] = await Promise.all([
    listCrmConnections(organization.id),
    listAltegioIntegrationAttempts(organization.id),
    getLocale(),
    getTranslator(),
  ]);
  const altegioCenter = resolveAltegioStatusCenter({
    attempts: attemptResult.attempts,
    connections,
  });
  const connectionCards = await Promise.all(
    connections.map(async (connection) => ({
      connection,
      metadata: await getBookingProvider(
        connection.provider,
      ).getConnectionMetadata(connection),
    })),
  );
  const altegioDetailsPath = `/app/organizations/${organization.id}/integrations/altegio`;
  const hasAltegioState = altegioCenter.status !== "not_connected";
  const altegioActionLabel = ["activation", "awaiting_return", "partial", "started", "verification"].includes(altegioCenter.status)
    ? locale === "ru" ? "Продолжить подключение" : "Қосылымды жалғастыру"
    : locale === "ru" ? "Открыть детали" : "Толық мәліметті ашу";

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-8 sm:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <OrganizationWorkspaceNavigation
          activeSection="integrations"
          organization={organization}
        />

        <section className="mt-9">
          <Link
            className="text-sm font-semibold text-indigo-700 hover:text-indigo-900"
            href={`/app/organizations/${organization.id}/integrations`}
          >
            {t("← Integrations")}
          </Link>

          <div className="mt-5">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
              {t("Your CRM connections")}
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-slate-600">
              {t(
                "Manage the CRM connections available to this organization. The external CRM remains the source of truth.",
              )}
            </p>
          </div>

          {query.deleted === "1" ? (
            <p
              className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              role="status"
            >
              {t("CRM connection deleted.")}
            </p>
          ) : null}

          <div className="mt-7 grid gap-4">
            {connectionCards.length ? (
              connectionCards.map(({ connection, metadata }) => (
                <article
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
                  key={connection.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-950">
                        {connection.displayName}
                      </h3>
                      <p className="mt-2 text-sm text-slate-600">
                        {t("Provider:")}{" "}
                        {t(metadata?.providerLabel ?? "CRM")}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {t("Last sync:")}{" "}
                        {formatLastSync(
                          connection.lastSyncAt,
                          locale,
                          t("Never"),
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClass(connection.status)}`}
                      >
                        {t(connection.status)}
                      </span>
                      <Link
                        className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                        href={connection.provider === "altegio"
                          ? altegioDetailsPath
                          : `/app/organizations/${organization.id}/integrations/crm/${connection.id}`}
                      >
                        {connection.provider === "altegio"
                          ? locale === "ru" ? "Детали" : "Толық мәлімет"
                          : t("Edit")}
                      </Link>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <h3 className="text-lg font-semibold text-slate-950">
                  {t("No connections yet")}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  {t(
                    "Choose an available provider below to start a connection.",
                  )}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-12 border-t border-slate-200 pt-10">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
            {t("Connect a new CRM")}
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            {t(
              "Choose a provider. Production integrations will become available after their adapters are implemented and verified.",
            )}
          </p>

          <div className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <CrmProviderCard
              action={
                hasAltegioState ? (
                  <Link
                    className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    href={altegioDetailsPath}
                  >
                    {altegioActionLabel}
                  </Link>
                ) : (
                  <AltegioMarketplaceConnectButton organizationId={organization.id} />
                )
              }
              actionLabel={t("Connect Altegio")}
              badge={integrationStatusLabel(altegioCenter.status, locale)}
              description={t(
                "You will be redirected to Altegio to choose one or more locations and confirm access. After confirmation, Altegio will return you to Orqelio.",
              )}
              monogram="A"
              name="Altegio"
              meta={altegioCenter.lastMeaningfulAt
                ? `${locale === "ru" ? "Последнее изменение" : "Соңғы өзгеріс"}: ${formatLastSync(altegioCenter.lastMeaningfulAt, locale, t("Never"))}`
                : undefined}
            />
            <CrmProviderCard
              actionLabel={t("Configure")}
              badge={t("Development only")}
              description={t(
                "Create a non-secret test connection for developing the integration foundation.",
              )}
              href={`/app/organizations/${organization.id}/integrations/crm/new`}
              monogram="DEV"
              name={t("Development connection")}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
