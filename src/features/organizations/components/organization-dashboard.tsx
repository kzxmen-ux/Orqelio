import Link from "next/link";

import type { Locale } from "@/lib/i18n/config";
import { getTranslator } from "@/lib/i18n/server";

import type { OrganizationDashboardData } from "../queries/organization-dashboard";
import type { Organization } from "../types";

type OrganizationDashboardProps = {
  data: OrganizationDashboardData;
  locale: Locale;
  organization: Organization;
};

type DashboardIconName =
  | "administrators"
  | "ai"
  | "analytics"
  | "integrations"
  | "messages"
  | "settings";

function DashboardIcon({ name }: { name: DashboardIconName }) {
  const paths: Record<DashboardIconName, React.ReactNode> = {
    administrators: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    ai: (
      <>
        <path d="m12 3-1.9 4.1L6 9l4.1 1.9L12 15l1.9-4.1L18 9l-4.1-1.9L12 3Z" />
        <path d="m5 15-.9 2.1L2 18l2.1.9L5 21l.9-2.1L8 18l-2.1-.9L5 15Z" />
        <path d="m19 14-1.3 2.7L15 18l2.7 1.3L19 22l1.3-2.7L23 18l-2.7-1.3L19 14Z" />
      </>
    ),
    analytics: (
      <>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
      </>
    ),
    integrations: (
      <>
        <path d="M8 12h8M12 8v8" />
        <rect x="3" y="3" width="18" height="18" rx="5" />
      </>
    ),
    messages: (
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {paths[name]}
    </svg>
  );
}

function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
    new Date(value),
  );
}

export async function OrganizationDashboard({
  data,
  locale,
  organization,
}: OrganizationDashboardProps) {
  const t = await getTranslator();
  const basePath = `/app/organizations/${organization.id}`;
  const crmPath = `${basePath}/integrations/crm`;
  const altegioConnected = data.altegio.status === "connected";
  const aiManagerReady = data.aiManagerStatus === "ready";
  const completedSteps = 1 + Number(altegioConnected) + Number(aiManagerReady);
  const totalSteps = 6;
  const progress = Math.round((completedSteps / totalSteps) * 100);
  const setupSteps = [
    { label: t("Organization created"), state: "completed" as const },
    {
      label: t("Altegio connected"),
      state: altegioConnected ? ("completed" as const) : ("current" as const),
    },
    { label: t("Services and staff imported"), state: "locked" as const },
    {
      label: t("AI manager configured"),
      state: aiManagerReady ? ("completed" as const) : ("current" as const),
    },
    { label: t("Messaging channel connected"), state: "locked" as const },
    { label: t("Orqelio launched"), state: "locked" as const },
  ];
  const statusDetails = {
    connected: {
      badge: t("Connected"),
      badgeClass: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
      description: t(
        "A connected Altegio CRM record exists for this organization.",
      ),
    },
    error: {
      badge: t("Connection error"),
      badgeClass: "bg-rose-50 text-rose-700 ring-rose-600/20",
      description: t("The saved Altegio connection is marked with an error."),
    },
    incomplete: {
      badge: t("Connection incomplete"),
      badgeClass: "bg-amber-50 text-amber-700 ring-amber-600/20",
      description:
        data.altegio.settingsDescription
          ? t(data.altegio.settingsDescription)
          : t("The Altegio connection still requires setup."),
    },
    not_connected: {
      badge: t("Not connected"),
      badgeClass: "bg-slate-100 text-slate-700 ring-slate-600/15",
      description: t("Altegio has not been added to this organization."),
    },
    paused: {
      badge: t("Paused"),
      badgeClass: "bg-slate-100 text-slate-700 ring-slate-600/15",
      description: t("The saved Altegio connection is marked as disconnected."),
    },
  }[data.altegio.status];
  const integrationAction =
    data.altegio.status === "not_connected"
      ? { href: crmPath, label: t("Connect integration") }
      : data.altegio.status === "incomplete" && data.altegio.connectionId
        ? {
            href: `${crmPath}/${data.altegio.connectionId}`,
            label: t("Continue connection"),
          }
        : { href: crmPath, label: t("Open integrations") };
  const primaryAction = !altegioConnected
    ? integrationAction
    : !aiManagerReady
      ? { href: `${basePath}/ai-manager`, label: t("Configure AI manager") }
      : integrationAction;
  const quickActions = [
    {
      description: t("Configure communication and human handoff rules."),
      href: `${basePath}/ai-manager`,
      icon: "ai" as const,
      label: t("AI manager"),
    },
    {
      description: t("Manage CRM connections and provider setup."),
      href: `${basePath}/integrations`,
      icon: "integrations" as const,
      label: t("Integrations"),
    },
    {
      description:
        organization.role === "owner"
          ? t("Invite and manage organization administrators.")
          : t("Only the organization owner can manage administrators."),
      href:
        organization.role === "owner"
          ? `${basePath}/administrators`
          : null,
      icon: "administrators" as const,
      label: t("Administrators"),
    },
    {
      description: t("Update the organization name and workspace address."),
      href: "#organization-settings",
      icon: "settings" as const,
      label: t("Organization settings"),
    },
  ];

  return (
    <>
      <section className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-gradient-to-br from-white via-white to-indigo-50/70 px-6 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-700">
                {t("Operational dashboard")}
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {organization.name}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
                {t(
                  "Connect systems and prepare Orqelio to work with customers.",
                )}
              </p>
            </div>
            <span className="w-fit rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
              {organization.role === "owner" ? t("Owner") : t("Admin")}
            </span>
          </div>
        </div>

        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">
                  {t("Setup progress")}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {completedSteps} / {totalSteps} {t("steps completed")}
                </p>
              </div>
              <span className="text-sm font-semibold tabular-nums text-indigo-700">
                {progress}%
              </span>
            </div>
            <div
              aria-label={t("Setup progress")}
              aria-valuemax={totalSteps}
              aria-valuemin={0}
              aria-valuenow={completedSteps}
              className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-indigo-600"
                style={{ width: `${progress}%` }}
              />
            </div>

            <ol className="mt-6 grid gap-3 sm:grid-cols-2">
              {setupSteps.map((step, index) => (
                <li
                  className={
                    step.state === "locked"
                      ? "flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-slate-500"
                      : step.state === "completed"
                        ? "flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-slate-800"
                        : "flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-slate-800"
                  }
                  key={step.label}
                >
                  <span
                    aria-hidden="true"
                    className={
                      step.state === "completed"
                        ? "grid size-7 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                        : step.state === "current"
                          ? "grid size-7 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white"
                          : "grid size-7 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600"
                    }
                  >
                    {step.state === "completed" ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {step.label}
                  </span>
                  {step.state === "locked" ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                      {t("Soon")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-300">
              {t("Next available action")}
            </p>
            <h3 className="mt-3 text-xl font-semibold">
              {altegioConnected
                ? aiManagerReady
                  ? t("Review your integration")
                  : t("Configure AI manager")
                : t("Connect integration")}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {altegioConnected
                ? aiManagerReady
                  ? t("Altegio and AI manager settings are ready. Review your integration when needed.")
                  : t("Add business context and handoff rules before Orqelio starts working with customers.")
                : t(
                    "Start with Altegio so Orqelio can use your existing business system when activation becomes available.",
                  )}
            </p>
            <Link
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              href={primaryAction.href}
            >
              {primaryAction.label}
            </Link>
          </aside>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid size-12 place-items-center rounded-2xl bg-slate-950 text-lg font-bold text-white">
                A
              </span>
              <div>
                <p className="text-sm text-slate-500">CRM</p>
                <h2 className="text-xl font-semibold text-slate-950">
                  {data.altegio.providerLabel}
                </h2>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${statusDetails.badgeClass}`}
            >
              {statusDetails.badge}
            </span>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-600">
            {statusDetails.description}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {t(
              "Status reflects the saved CRM connection only and does not claim live API health.",
            )}
          </p>
          <Link
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            href={primaryAction.href}
          >
            {primaryAction.label}
          </Link>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold text-slate-950">
            {t("Organization summary")}
          </h2>
          <dl className="mt-5 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <dt className="text-sm text-slate-500">{t("Organization")}</dt>
              <dd className="text-right text-sm font-semibold text-slate-900">
                {organization.name}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <dt className="text-sm text-slate-500">{t("Your role")}</dt>
              <dd className="text-right text-sm font-semibold text-slate-900">
                {organization.role === "owner" ? t("Owner") : t("Admin")}
              </dd>
            </div>
            {data.memberCount !== null ? (
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <dt className="text-sm text-slate-500">{t("Team members")}</dt>
                <dd className="text-right text-sm font-semibold tabular-nums text-slate-900">
                  {data.memberCount}
                </dd>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <dt className="text-sm text-slate-500">{t("Altegio status")}</dt>
              <dd className="text-right text-sm font-semibold text-slate-900">
                {statusDetails.badge}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-sm text-slate-500">{t("Created")}</dt>
              <dd className="text-right text-sm font-semibold text-slate-900">
                {formatDate(organization.createdAt, locale)}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="mt-8">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">
            {t("Quick actions")}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {t("Open the organization areas available today.")}
          </p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) =>
            action.href ? (
              <Link
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                href={action.href}
                key={action.label}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700 transition group-hover:bg-indigo-100">
                  <DashboardIcon name={action.icon} />
                </span>
                <span className="mt-4 block font-semibold text-slate-950">
                  {action.label}
                </span>
                <span className="mt-2 block text-sm leading-6 text-slate-600">
                  {action.description}
                </span>
              </Link>
            ) : (
              <div
                aria-disabled="true"
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-500"
                key={action.label}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-slate-200/70 text-slate-500">
                  <DashboardIcon name={action.icon} />
                </span>
                <span className="mt-4 block font-semibold text-slate-700">
                  {action.label}
                </span>
                <span className="mt-2 block text-sm leading-6">
                  {action.description}
                </span>
              </div>
            ),
          )}
          {[
            { icon: "messages" as const, label: t("Messages") },
            { icon: "analytics" as const, label: t("Analytics") },
          ].map((action) => (
            <div
              aria-disabled="true"
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 text-slate-500"
              key={action.label}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-slate-200/70 text-slate-500">
                  <DashboardIcon name={action.icon} />
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                  {t("Soon")}
                </span>
              </div>
              <span className="mt-4 block font-semibold text-slate-700">
                {action.label}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
