"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { saveAiManagerSettingsAction } from "../actions/ai-manager-settings";
import type {
  AiManagerActionState,
  AiManagerConfiguration,
  AiManagerWarningCode,
} from "../types";
import { getAiManagerWarnings } from "../validation/ai-manager-settings";
import type { Locale } from "@/lib/i18n/config";

const initialActionState: AiManagerActionState = { status: "idle" };

const copy = {
  ru: {
    address_missing: "Добавьте заполненный адрес.",
    cancellation_rules_missing: "Опишите правила отмены и переноса.",
    handoff_rules_missing: "Выберите хотя бы один случай передачи администратору.",
    payment_methods_missing: "Укажите доступные способы оплаты.",
    language: "Основной язык",
    formality: "Обращение",
    style: "Стиль общения",
    russian: "Русский",
    kazakh: "Қазақша",
    formalAddress: "Формально — «Вы»",
    informalAddress: "Неформально — «Ты»",
    friendly: "Дружелюбный",
    neutral: "Нейтральный",
    formal: "Официальный",
    context: "Контекст о бизнесе",
    contextHelp: "Расскажите только то, что помогает общаться с клиентами. Услуги, цены, сотрудники и расписание должны оставаться в Altegio.",
    handoff: "Передача администратору",
    handoffHelp: "Orqelio должна остановить автоматический ответ и передать диалог человеку в выбранных случаях.",
    handoffSafety: "Обязательные правила безопасности Orqelio действуют всегда: настройки организации могут добавить случаи передачи, но не отключить запрос человека, медицинский риск или спор по оплате.",
    rules: ["Клиент просит администратора", "AI не понимает запрос", "Ошибка при записи", "Жалоба клиента", "Медицинский вопрос или противопоказания", "Возврат денег / спор по оплате"],
    other: "Другие случаи (необязательно)",
    validation: "Что нужно дополнить для статуса «Готово»",
    draftAllowed: "Черновик можно сохранить сейчас. Статус «Готово» присваивается только после заполнения обязательных данных.",
    save: "Сохранить настройки",
    saving: "Сохраняем…",
    saved: "Сохранено",
    dirty: "Есть несохранённые изменения",
    draft: "Черновик",
    ready: "Готово",
    success: "Настройки AI-менеджера сохранены.",
    unchanged: "Настройки не изменились.",
    failed: "Не удалось сохранить настройки. Попробуйте ещё раз.",
    conflict: "Настройки изменены в другой сессии. Обновите страницу и повторите попытку.",
    session: "Сессия истекла. Войдите снова.",
    invalid: "Проверьте заполненные поля.",
  },
  kk: {
    address_missing: "Толтырылған мекенжайды қосыңыз.",
    cancellation_rules_missing: "Бас тарту және ауыстыру ережелерін сипаттаңыз.",
    handoff_rules_missing: "Әкімшіге берудің кемінде бір жағдайын таңдаңыз.",
    payment_methods_missing: "Қолжетімді төлем тәсілдерін көрсетіңіз.",
    language: "Негізгі тіл",
    formality: "Қаратпа түрі",
    style: "Сөйлесу мәнері",
    russian: "Русский",
    kazakh: "Қазақша",
    formalAddress: "Ресми — «Сіз»",
    informalAddress: "Бейресми — «Сен»",
    friendly: "Жылы",
    neutral: "Бейтарап",
    formal: "Ресми",
    context: "Бизнес туралы контекст",
    contextHelp: "Клиенттермен сөйлесуге көмектесетін ақпаратты ғана жазыңыз. Қызметтер, бағалар, қызметкерлер және кесте Altegio-да қалуы тиіс.",
    handoff: "Әкімшіге беру",
    handoffHelp: "Таңдалған жағдайларда Orqelio автоматты жауапты тоқтатып, диалогты адамға беруі тиіс.",
    handoffSafety: "Orqelio-ның міндетті қауіпсіздік ережелері әрқашан қолданылады: ұйым баптаулары беру жағдайларын қоса алады, бірақ адамды сұрауды, медициналық қауіпті немесе төлем дауын өшіре алмайды.",
    rules: ["Клиент әкімшіні сұрайды", "Orqelio жауапқа сенімді емес", "Жазылу қатесі", "Клиент шағымы", "Медициналық сұрақ", "Төлем дауы"],
    other: "Басқа жағдайлар (міндетті емес)",
    validation: "«Дайын» мәртебесі үшін толықтыру қажет",
    draftAllowed: "Қазір нобай ретінде сақтауға болады. «Дайын» мәртебесі міндетті деректер толтырылғанда ғана беріледі.",
    save: "Баптауларды сақтау",
    saving: "Сақталуда…",
    saved: "Сақталды",
    dirty: "Сақталмаған өзгерістер бар",
    draft: "Нобай",
    ready: "Дайын",
    success: "ЖИ-менеджер баптаулары сақталды.",
    unchanged: "Баптаулар өзгерген жоқ.",
    failed: "Баптауларды сақтау мүмкін болмады. Қайта көріңіз.",
    conflict: "Баптаулар басқа сессияда өзгертілді. Бетті жаңартып, қайта көріңіз.",
    session: "Сессия аяқталды. Қайта кіріңіз.",
    invalid: "Толтырылған өрістерді тексеріңіз.",
  },
} satisfies Record<Locale, Record<string, string | string[]>>;

const handoffNames = [
  "handoffClientRequestsAdmin",
  "handoffAiUncertain",
  "handoffBookingError",
  "handoffCustomerComplaint",
  "handoffMedicalQuestion",
  "handoffPaymentDispute",
] as const;

export function AiManagerSettingsForm({
  configuration,
  locale,
}: {
  configuration: AiManagerConfiguration;
  locale: Locale;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveAiManagerSettingsAction,
    initialActionState,
  );
  const [dirty, setDirty] = useState(false);
  const c = copy[locale];
  const initialWarnings = getAiManagerWarnings({
    handoff: configuration.handoff,
    rawBusinessContext: configuration.rawBusinessContext,
  });
  const warnings = state.warnings ?? initialWarnings;
  const status = state.savedStatus ?? configuration.status;
  const localizedMessage = state.message
    ? ({
        "AI manager settings saved.": c.success,
        "AI manager settings have not changed.": c.unchanged,
        "AI manager settings could not be saved. Try again.": c.failed,
        "Settings changed in another session. Refresh and try again.": c.conflict,
        "Your session has expired. Sign in and try again.": c.session,
        "Check the highlighted fields.": c.invalid,
      } as Record<string, string>)[state.message] ?? state.message
    : null;

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-8" onChange={() => setDirty(true)}>
      <input name="organizationId" type="hidden" value={configuration.organizationId} />
      <input name="expectedVersion" type="hidden" value={configuration.version} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status === "ready" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {status === "ready" ? c.ready : c.draft}
        </span>
        <span aria-live="polite" className="text-sm font-medium text-slate-600">
          {pending ? c.saving : dirty ? c.dirty : c.saved}
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Select label={c.language as string} name="primaryLanguage" defaultValue={configuration.primaryLanguage} options={[["ru", c.russian as string], ["kk", c.kazakh as string]]} />
        <Select label={c.formality as string} name="formality" defaultValue={configuration.formality} options={[["formal", c.formalAddress as string], ["informal", c.informalAddress as string]]} />
        <Select label={c.style as string} name="communicationStyle" defaultValue={configuration.communicationStyle} options={[["friendly", c.friendly as string], ["neutral", c.neutral as string], ["formal", c.formal as string]]} />
      </div>

      <div>
        <label className="text-sm font-semibold text-slate-900" htmlFor="rawBusinessContext">{c.context}</label>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{c.contextHelp}</p>
        <textarea className="mt-3 min-h-96 w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 font-mono text-sm leading-6 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" defaultValue={configuration.rawBusinessContext} id="rawBusinessContext" maxLength={30000} name="rawBusinessContext" required />
        {state.fieldErrors?.rawBusinessContext?.map((error) => <p className="mt-2 text-sm text-rose-700" key={error}>{error}</p>)}
      </div>

      <fieldset className="rounded-2xl border border-slate-200 p-5 sm:p-6">
        <legend className="px-2 text-base font-semibold text-slate-950">{c.handoff}</legend>
        <p className="text-sm leading-6 text-slate-600">{c.handoffHelp}</p>
        <p className="mt-2 rounded-xl bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900">{c.handoffSafety}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {handoffNames.map((name, index) => {
            const values = [configuration.handoff.clientRequestsAdmin, configuration.handoff.aiUncertain, configuration.handoff.bookingError, configuration.handoff.customerComplaint, configuration.handoff.medicalQuestion, configuration.handoff.paymentDispute];
            return <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-800 transition hover:bg-slate-50" key={name}><input className="mt-0.5 size-4 accent-indigo-600" defaultChecked={values[index]} name={name} type="checkbox" /><span>{(c.rules as string[])[index]}</span></label>;
          })}
        </div>
        <label className="mt-5 block text-sm font-medium text-slate-800" htmlFor="handoffOtherCases">{c.other}</label>
        <textarea className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" defaultValue={configuration.handoff.otherCases} id="handoffOtherCases" maxLength={2000} name="handoffOtherCases" />
      </fieldset>

      {warnings.length ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h3 className="font-semibold text-amber-950">{c.validation}</h3><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{warnings.map((warning: AiManagerWarningCode) => <li key={warning}>{c[warning]}</li>)}</ul><p className="mt-3 text-xs leading-5 text-amber-800">{c.draftAllowed}</p></div> : null}

      {localizedMessage ? <p aria-live="polite" className={state.status === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>{localizedMessage}</p> : null}
      <button className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60" disabled={pending} type="submit">{pending ? c.saving : c.save}</button>
    </form>
  );
}

function Select({ defaultValue, label, name, options }: { defaultValue: string; label: string; name: string; options: [string, string][] }) {
  return <label className="text-sm font-semibold text-slate-900">{label}<select className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200" defaultValue={defaultValue} name={name}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
}
