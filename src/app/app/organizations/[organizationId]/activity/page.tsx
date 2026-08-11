import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getAuditEventPresentation } from "@/features/audit-log/presentation";
import { listOrganizationAuditEvents } from "@/features/audit-log/queries/audit-events";
import type { AuditCategory } from "@/features/audit-log/types";
import { OrganizationWorkspaceNavigation } from "@/features/organizations/components/organization-workspace-navigation";
import { getOrganizationForCurrentUser } from "@/features/organizations/queries/organizations";
import { organizationIdSchema } from "@/features/organizations/validation/organization";
import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  category: z.enum(["all", "ai", "administrators", "integrations"]).catch("all"),
  page: z.coerce.number().int().min(0).catch(0),
});

export default async function OrganizationActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const parsedOrganizationId = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsedOrganizationId.success) notFound();

  const organization = await getOrganizationForCurrentUser(parsedOrganizationId.data);
  if (!organization) notFound();

  const query = querySchema.parse(await searchParams);
  const supabase = await createClient();
  const [locale, result, authResult] = await Promise.all([
    getLocale(),
    listOrganizationAuditEvents({
      category: query.category,
      organizationId: organization.id,
      page: query.page,
    }),
    supabase.auth.getUser(),
  ]);
  const ru = locale === "ru";
  const currentUserId = authResult.data.user?.id ?? null;
  const basePath = `/app/organizations/${organization.id}/activity`;
  const filters: Array<{ label: string; value: AuditCategory }> = [
    { label: ru ? "Все" : "Барлығы", value: "all" },
    { label: ru ? "AI-менеджер" : "ЖИ-менеджер", value: "ai" },
    { label: ru ? "Администраторы" : "Әкімшілер", value: "administrators" },
    { label: ru ? "Интеграции" : "Интеграциялар", value: "integrations" },
  ];
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const pageHref = (page: number) =>
    `${basePath}?category=${query.category}&page=${page}`;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto w-full max-w-7xl">
        <OrganizationWorkspaceNavigation activeSection="activity" organization={organization} />

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.15em] text-indigo-700">
              {ru ? "Организация" : "Ұйым"}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {ru ? "История действий" : "Әрекеттер тарихы"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-base">
              {ru
                ? "Неизменяемая история важных действий администраторов и интеграций. Журнал начинается с момента запуска этой функции."
                : "Әкімшілер мен интеграциялардың маңызды әрекеттерінің өзгермейтін тарихы. Журнал осы мүмкіндік іске қосылған сәттен басталады."}
            </p>
          </div>

          <nav aria-label={ru ? "Фильтр истории" : "Тарих сүзгісі"} className="mt-7 flex gap-2 overflow-x-auto border-b border-slate-200 pb-4">
            {filters.map((filter) => {
              const active = query.category === filter.value;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "whitespace-nowrap rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white" : "whitespace-nowrap rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"}
                  href={`${basePath}?category=${filter.value}`}
                  key={filter.value}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>

          {result.status === "error" ? (
            <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800" role="alert">
              {ru ? "Не удалось загрузить историю действий. Попробуйте обновить страницу." : "Әрекеттер тарихын жүктеу мүмкін болмады. Бетті жаңартып көріңіз."}
            </div>
          ) : result.events.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <h2 className="font-semibold text-slate-900">{ru ? "Действий пока нет" : "Әзірге әрекеттер жоқ"}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{ru ? "Новые административные действия появятся здесь после выполнения. Прошлая история не создаётся задним числом." : "Жаңа әкімшілік әрекеттер орындалғаннан кейін осында пайда болады. Бұрынғы тарих кейіннен жасалмайды."}</p>
            </div>
          ) : (
            <ol className="mt-8 space-y-4">
              {result.events.map((event) => {
                const presentation = getAuditEventPresentation(event, locale);
                const badgeClass = {
                  administrators: "bg-sky-50 text-sky-700 ring-sky-600/20",
                  ai: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
                  integrations: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
                }[presentation.category];

                return (
                  <li className="relative rounded-2xl border border-slate-200 p-5 sm:p-6" key={event.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${badgeClass}`}>{presentation.badge}</span>
                          <time className="text-xs text-slate-500" dateTime={event.createdAt}>{formatter.format(new Date(event.createdAt))}</time>
                        </div>
                        <h2 className="mt-3 font-semibold text-slate-950">{presentation.title}</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{presentation.description}</p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-slate-500">
                        {event.actorUserId === currentUserId
                          ? ru ? "Выполнено вами" : "Сіз орындадыңыз"
                          : event.actorUserId
                            ? ru ? "Администратор организации" : "Ұйым әкімшісі"
                            : ru ? "Системное действие" : "Жүйелік әрекет"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {result.status === "success" && (query.page > 0 || result.hasMore) ? (
            <nav aria-label={ru ? "Страницы истории" : "Тарих беттері"} className="mt-7 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
              {query.page > 0 ? <Link className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" href={pageHref(query.page - 1)}>{ru ? "Новые события" : "Жаңа оқиғалар"}</Link> : <span />}
              {result.hasMore ? <Link className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" href={pageHref(query.page + 1)}>{ru ? "Показать более ранние" : "Бұрынғыларын көрсету"}</Link> : null}
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}
