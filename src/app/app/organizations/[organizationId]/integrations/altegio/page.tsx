import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { listOrganizationAuditEvents } from "@/features/audit-log/queries/audit-events";
import { getAuditEventPresentation } from "@/features/audit-log/presentation";
import { retryAltegioMarketplaceActivationAction } from "@/features/crm-connections/actions/altegio-marketplace";
import { AltegioMarketplaceConnectButton } from "@/features/crm-connections/components/altegio-marketplace-connect-button";
import {
  ALTEGIO_MARKETPLACE_ORGANIZATION_COOKIE,
  ALTEGIO_MARKETPLACE_URL,
  parseAltegioMarketplaceCookie,
} from "@/features/crm-connections/marketplace/altegio";
import { createIntegrationDiagnosticReference } from "@/features/integration-status/diagnostic-reference";
import { CopyDiagnosticReferenceButton } from "@/features/integration-status/components/copy-diagnostic-reference-button";
import {
  attemptStatusLabel,
  integrationErrorLabel,
  integrationStatusLabel,
} from "@/features/integration-status/presentation";
import { getAltegioStatusCenter } from "@/features/integration-status/queries/altegio-status";
import { getAttemptErrorCategory } from "@/features/integration-status/status-center";
import type { ProgressStepState } from "@/features/integration-status/types";
import { OrganizationWorkspaceNavigation } from "@/features/organizations/components/organization-workspace-navigation";
import { getOrganizationForCurrentUser } from "@/features/organizations/queries/organizations";
import { organizationIdSchema } from "@/features/organizations/validation/organization";
import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AltegioIntegrationStatusPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const parsedId = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsedId.success) notFound();
  const organization = await getOrganizationForCurrentUser(parsedId.data);
  if (!organization) notFound();

  const supabase = await createClient();
  const [locale, statusResult, activity, authResult, cookieStore] = await Promise.all([
    getLocale(),
    getAltegioStatusCenter(organization.id),
    listOrganizationAuditEvents({ category: "integrations", organizationId: organization.id, page: 0 }),
    supabase.auth.getUser(),
    cookies(),
  ]);
  const ru = locale === "ru";
  const center = statusResult.center;
  const currentUserId = authResult.data.user?.id ?? null;
  const cookieContext = parseAltegioMarketplaceCookie(
    cookieStore.get(ALTEGIO_MARKETPLACE_ORGANIZATION_COOKIE)?.value,
  );
  const ownsLatestAttempt = Boolean(
    center.latestAttempt &&
    cookieContext &&
    cookieContext.attemptId === center.latestAttempt.attemptId &&
    cookieContext.organizationId === organization.id,
  );
  const canRetry = Boolean(center.latestAttempt?.canRetry && ownsLatestAttempt);
  const canContinue = Boolean(
    ownsLatestAttempt &&
    ["awaiting_return", "activation", "verification"].includes(center.status),
  );
  const showConnect = ["not_connected", "disconnected", "error"].includes(center.status) && !canRetry;
  const integrationsPath = `/app/organizations/${organization.id}/integrations/crm`;
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const stepLabels = {
    activated: ru ? "Доступ активирован" : "Рұқсат белсендірілді",
    callback: ru ? "Altegio вернула филиалы" : "Altegio филиалдарды қайтарды",
    completed: ru ? "Подключение завершено" : "Қосылым аяқталды",
    started: ru ? "Подключение начато" : "Қосылым басталды",
    verified: ru ? "API-доступ проверен" : "API рұқсаты тексерілді",
  };
  const statusTone = {
    connected: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    disconnected: "bg-slate-100 text-slate-700 ring-slate-600/15",
    error: "bg-rose-50 text-rose-800 ring-rose-600/20",
    not_connected: "bg-slate-100 text-slate-700 ring-slate-600/15",
    partial: "bg-amber-50 text-amber-800 ring-amber-600/20",
    paused: "bg-slate-100 text-slate-700 ring-slate-600/15",
    activation: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
    awaiting_return: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
    started: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
    verification: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  }[center.status];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-7xl">
        <OrganizationWorkspaceNavigation activeSection="integrations" organization={organization} />
        <section className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-br from-white to-indigo-50/60 p-6 sm:p-8">
            <Link className="text-sm font-semibold text-indigo-700 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" href={integrationsPath}>{ru ? "← Интеграции" : "← Интеграциялар"}</Link>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-700">CRM</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Altegio</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{ru ? "Реальное состояние подключения, этапы активации и последние безопасные попытки." : "Қосылымның нақты күйі, белсендіру кезеңдері және соңғы қауіпсіз әрекеттер."}</p></div>
              <span className={`w-fit rounded-full px-3.5 py-2 text-xs font-semibold ring-1 ring-inset ${statusTone}`}>{integrationStatusLabel(center.status, locale)}</span>
            </div>
            {center.lastMeaningfulAt ? <p className="mt-4 text-xs text-slate-500">{ru ? "Последнее изменение" : "Соңғы өзгеріс"}: {formatter.format(new Date(center.lastMeaningfulAt))}</p> : null}
          </div>

          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">{ru ? "Прогресс подключения" : "Қосылу барысы"}</h2>
              {center.latestAttempt && center.latestAttempt.selectedLocationCount > 0 ? <p className="mt-2 text-sm text-slate-600">{ru ? `${center.latestAttempt.activatedLocationCount} из ${center.latestAttempt.selectedLocationCount} филиалов активированы · ${center.latestAttempt.verifiedLocationCount} проверены` : `${center.latestAttempt.selectedLocationCount} филиалдың ${center.latestAttempt.activatedLocationCount}-і белсендірілді · ${center.latestAttempt.verifiedLocationCount}-і тексерілді`}</p> : null}
              <ol className="mt-5 space-y-3">{center.progress.map((step, index) => <ProgressStep index={index} key={step.key} label={stepLabels[step.key]} state={step.state} />)}</ol>
            </div>

            <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h2 className="font-semibold text-slate-950">{ru ? "Доступные действия" : "Қолжетімді әрекеттер"}</h2>
              {center.errorCategory ? <div className="mt-4 rounded-xl border border-rose-200 bg-white p-4"><p className="text-sm font-semibold text-rose-800">{integrationErrorLabel(center.errorCategory, locale)}</p><p className="mt-1 text-xs leading-5 text-slate-600">{ru ? "Технические ответы провайдера скрыты. Используйте диагностический номер при обращении в поддержку." : "Провайдердің техникалық жауаптары жасырылған. Қолдауға жүгінгенде диагностикалық нөмірді пайдаланыңыз."}</p></div> : null}
              <div className="mt-5 space-y-3">
                {canRetry ? <form action={retryAltegioMarketplaceActivationAction}><button className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" type="submit">{ru ? "Повторить активацию" : "Белсендіруді қайталау"}</button></form> : null}
                {canContinue ? <Link className="inline-flex w-full justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" href={center.status === "awaiting_return" ? ALTEGIO_MARKETPLACE_URL : "/integrations/altegio/callback?resume=1"}>{ru ? "Продолжить подключение" : "Қосылымды жалғастыру"}</Link> : null}
                {showConnect ? <AltegioMarketplaceConnectButton organizationId={organization.id} /> : null}
                <Link className="inline-flex w-full justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" href={integrationsPath}>{ru ? "Вернуться в интеграции" : "Интеграцияларға оралу"}</Link>
              </div>
              {!ownsLatestAttempt && center.latestAttempt && ["awaiting_return", "activation", "verification", "partial"].includes(center.status) ? <p className="mt-4 text-xs leading-5 text-slate-500">{ru ? "Продолжить эту попытку может только администратор в исходном защищённом браузере. Вы можете начать новую попытку со страницы интеграций." : "Бұл әрекетті бастапқы қорғалған браузердегі әкімші ғана жалғастыра алады. Интеграциялар бетінен жаңа әрекетті бастауға болады."}</p> : null}
            </aside>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-slate-950">
            {ru ? "Последние попытки подключения" : "Соңғы қосылу әрекеттері"}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {ru
              ? "Показываются только безопасные статусы и категории ошибок — без филиальных ID, токенов и ответов API."
              : "Тек қауіпсіз күйлер мен қате санаттары көрсетіледі — филиал ID, токендер және API жауаптарынсыз."}
          </p>
          {statusResult.status === "error" ? (
            <p className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">
              {ru ? "Не удалось загрузить попытки подключения." : "Қосылу әрекеттерін жүктеу мүмкін болмады."}
            </p>
          ) : center.attempts.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500">
                    <th className="border-b border-slate-200 px-3 py-3">{ru ? "Время" : "Уақыт"}</th>
                    <th className="border-b border-slate-200 px-3 py-3">{ru ? "Состояние" : "Күй"}</th>
                    <th className="border-b border-slate-200 px-3 py-3">{ru ? "Филиалы" : "Филиалдар"}</th>
                    <th className="border-b border-slate-200 px-3 py-3">{ru ? "Исполнитель" : "Орындаушы"}</th>
                    <th className="border-b border-slate-200 px-3 py-3">{ru ? "Диагностика" : "Диагностика"}</th>
                  </tr>
                </thead>
                <tbody>
                  {center.attempts.map((attempt) => {
                    const attemptError = getAttemptErrorCategory(attempt);
                    const reference = createIntegrationDiagnosticReference(attempt.attemptId);
                    return (
                      <tr key={attempt.attemptId}>
                        <td className="border-b border-slate-100 px-3 py-4 text-slate-600">{formatter.format(new Date(attempt.createdAt))}</td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          <span className="font-semibold text-slate-900">{attemptStatusLabel(attempt, locale)}</span>
                          {attemptError ? <span className="mt-1 block text-xs text-rose-700">{integrationErrorLabel(attemptError, locale)}</span> : null}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-4 text-slate-600">{attempt.selectedLocationCount ? `${attempt.verifiedLocationCount}/${attempt.selectedLocationCount}` : "—"}</td>
                        <td className="border-b border-slate-100 px-3 py-4 text-slate-600">{attempt.actorUserId === currentUserId ? (ru ? "Вы" : "Сіз") : (ru ? "Администратор" : "Әкімші")}</td>
                        <td className="border-b border-slate-100 px-3 py-4">
                          <div className="flex items-center gap-2">
                            <code className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">{reference}</code>
                            <CopyDiagnosticReferenceButton locale={locale} reference={reference} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
              {ru ? "Попыток подключения пока нет." : "Әзірге қосылу әрекеттері жоқ."}
            </p>
          )}
        </section>

        {activity.status === "success" && activity.events.length ? <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="flex items-center justify-between gap-4"><h2 className="text-xl font-semibold text-slate-950">{ru ? "Последняя активность" : "Соңғы белсенділік"}</h2><Link className="text-sm font-semibold text-indigo-700 hover:text-indigo-900" href={`/app/organizations/${organization.id}/activity?category=integrations`}>{ru ? "Вся история" : "Барлық тарих"}</Link></div><ol className="mt-5 space-y-3">{activity.events.slice(0, 5).map((event) => { const item = getAuditEventPresentation(event, locale); return <li className="flex flex-col gap-1 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between" key={event.id}><div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-600">{item.description}</p></div><time className="shrink-0 text-xs text-slate-500" dateTime={event.createdAt}>{formatter.format(new Date(event.createdAt))}</time></li>; })}</ol></section> : null}
      </div>
    </main>
  );
}

function ProgressStep({ index, label, state }: { index: number; label: string; state: ProgressStepState }) {
  const styles: Record<ProgressStepState, string> = { completed: "border-emerald-200 bg-emerald-50 text-emerald-900", current: "border-indigo-200 bg-indigo-50 text-indigo-900", failed: "border-rose-200 bg-rose-50 text-rose-900", pending: "border-slate-200 bg-slate-50 text-slate-500" };
  const marker: Record<ProgressStepState, string> = { completed: "✓", current: String(index + 1), failed: "!", pending: String(index + 1) };
  return <li className={`flex items-center gap-3 rounded-xl border p-4 ${styles[state]}`}><span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-bold shadow-sm">{marker[state]}</span><span className="text-sm font-semibold">{label}</span></li>;
}
