import { notFound } from "next/navigation";

import { AiManagerSettingsForm } from "@/features/ai-manager-settings/components/ai-manager-settings-form";
import { RestoreVersionButton } from "@/features/ai-manager-settings/components/restore-version-button";
import { BUSINESS_CONTEXT_TEMPLATES } from "@/features/ai-manager-settings/templates";
import type { AiManagerConfiguration } from "@/features/ai-manager-settings/types";
import { getAiManagerSettingsPageData } from "@/features/ai-manager-settings/queries/ai-manager-settings";
import { OrganizationWorkspaceNavigation } from "@/features/organizations/components/organization-workspace-navigation";
import { getOrganizationForCurrentUser } from "@/features/organizations/queries/organizations";
import { organizationIdSchema } from "@/features/organizations/validation/organization";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function AiManagerSettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organization = await getOrganizationForCurrentUser(parsed.data);
  if (!organization) notFound();

  const [locale, data] = await Promise.all([
    getLocale(),
    getAiManagerSettingsPageData(organization.id),
  ]);
  const now = new Date().toISOString();
  const configuration: AiManagerConfiguration = data.configuration ?? {
    communicationStyle: "friendly",
    createdAt: now,
    formality: "formal",
    handoff: {
      aiUncertain: true,
      bookingError: true,
      clientRequestsAdmin: true,
      customerComplaint: true,
      medicalQuestion: true,
      otherCases: "",
      paymentDispute: true,
    },
    organizationId: organization.id,
    primaryLanguage: locale,
    rawBusinessContext: BUSINESS_CONTEXT_TEMPLATES[locale],
    status: "draft",
    updatedAt: now,
    updatedBy: data.currentUserId ?? "",
    version: 0,
  };
  const ru = locale === "ru";
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-7xl">
        <OrganizationWorkspaceNavigation activeSection="ai-manager" organization={organization} />
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-indigo-700">{ru ? "Настройки Orqelio" : "Orqelio баптаулары"}</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{ru ? "Настройка AI-менеджера" : "ЖИ-менеджерді баптау"}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">{ru ? "Расскажите Orqelio о вашем бизнесе и настройте, как AI должен общаться с клиентами." : "Orqelio-ға бизнесіңіз туралы айтып, ЖИ клиенттермен қалай сөйлесуі керектігін баптаңыз."}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{ru ? "Контекст считается недоверенными бизнес-данными и не может отключать неизменяемые правила безопасности Orqelio." : "Контекст сенімсіз бизнес деректері болып саналады және Orqelio-ның өзгермейтін қауіпсіздік ережелерін өшіре алмайды."}</p>
            {data.configuration ? <p className="mt-3 text-xs text-slate-500">{ru ? "Обновлено" : "Жаңартылды"}: {dateFormatter.format(new Date(data.configuration.updatedAt))} · {data.configuration.updatedBy === data.currentUserId ? (ru ? "вами" : "сізбен") : (ru ? "администратором организации" : "ұйым әкімшісімен")}</p> : null}
          </div>
          <div className="mt-8 border-t border-slate-100 pt-8">
            <AiManagerSettingsForm configuration={configuration} key={configuration.version} locale={locale} />
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-slate-950">{ru ? "История версий" : "Нұсқалар тарихы"}</h2>
          <p className="mt-2 text-sm text-slate-600">{ru ? "Каждое сохранение создаёт неизменяемый снимок. Восстановление также создаёт новую версию." : "Әр сақтау өзгермейтін сурет жасайды. Қалпына келтіру де жаңа нұсқа жасайды."}</p>
          {data.versions.length ? <div className="mt-5 space-y-3">{data.versions.map((version) => <details className="rounded-2xl border border-slate-200 p-4" key={version.version}><summary className="cursor-pointer list-none font-semibold text-slate-900"><span>{ru ? "Версия" : "Нұсқа"} {version.version}</span>{version.version === configuration.version ? <span className="ml-2 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">{ru ? "Текущая" : "Ағымдағы"}</span> : null}<span className="ml-3 text-xs font-normal text-slate-500">{dateFormatter.format(new Date(version.createdAt))} · {version.status === "ready" ? (ru ? "Готово" : "Дайын") : (ru ? "Черновик" : "Нобай")} · {version.createdBy === data.currentUserId ? (ru ? "вы" : "сіз") : (ru ? "администратор организации" : "ұйым әкімшісі")}</span></summary><div className="mt-4 border-t border-slate-100 pt-4"><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-700">{version.rawBusinessContext}</pre><div className="mt-4"><RestoreVersionButton expectedVersion={configuration.version} locale={locale} organizationId={organization.id} version={version.version} /></div></div></details>)}</div> : <p className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">{ru ? "История появится после первого сохранения." : "Тарих алғашқы сақтаудан кейін пайда болады."}</p>}
        </section>
      </div>
    </main>
  );
}
