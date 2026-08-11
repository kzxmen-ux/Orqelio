import Link from "next/link";

import { getTranslator } from "@/lib/i18n/server";

import type { Organization } from "../types";

type WorkspaceSection =
  | "administrators"
  | "activity"
  | "ai-manager"
  | "integrations"
  | "overview"
  | "settings";

type OrganizationWorkspaceNavigationProps = {
  activeSection: WorkspaceSection;
  organization: Organization;
};

export async function OrganizationWorkspaceNavigation({
  activeSection,
  organization,
}: OrganizationWorkspaceNavigationProps) {
  const t = await getTranslator();
  const basePath = `/app/organizations/${organization.id}`;
  const links = [
    { href: basePath, label: t("Home"), section: "overview" as const },
    {
      href: `${basePath}/integrations`,
      label: t("Integrations"),
      section: "integrations" as const,
    },
    {
      href: `${basePath}/ai-manager`,
      label: t("AI manager"),
      section: "ai-manager" as const,
    },
    {
      href: `${basePath}/activity`,
      label: t("Activity history"),
      section: "activity" as const,
    },
    {
      href:
        organization.role === "owner"
          ? `${basePath}/administrators`
          : null,
      label: t("Administrators"),
      section: "administrators" as const,
    },
    {
      href: `${basePath}#organization-settings`,
      label: t("Settings"),
      section: "settings" as const,
    },
  ];

  return (
    <header className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-sm font-bold text-white"
          >
            O
          </span>
          <div className="min-w-0">
            <Link
              className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              href="/app"
            >
              {t("← All organizations")}
            </Link>
            <p className="truncate text-base font-semibold text-slate-950">
              {organization.name}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
          {organization.role === "owner" ? t("Owner") : t("Admin")}
        </span>
      </div>

      <nav
        aria-label={t("Organization workspace")}
        className="mt-4 flex gap-1 overflow-x-auto border-t border-slate-100 pt-3"
      >
        {links.map((link) => {
          const active = link.section === activeSection;

          return link.href ? (
            <Link
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "whitespace-nowrap rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white"
                  : "whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              }
              href={link.href}
              key={link.section}
            >
              {link.label}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="cursor-not-allowed whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-400"
              key={link.section}
              title={t("Only the organization owner can manage administrators.")}
            >
              {link.label}
            </span>
          );
        })}
      </nav>
    </header>
  );
}
