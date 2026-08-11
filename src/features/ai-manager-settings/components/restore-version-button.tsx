"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { restoreAiManagerSettingsAction } from "../actions/ai-manager-settings";
import type { AiManagerActionState } from "../types";
import type { Locale } from "@/lib/i18n/config";

const initialState: AiManagerActionState = { status: "idle" };

export function RestoreVersionButton({ expectedVersion, locale, organizationId, version }: { expectedVersion: number; locale: Locale; organizationId: string; version: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(restoreAiManagerSettingsAction, initialState);
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state]);
  const message = state.message
    ? state.status === "success"
      ? locale === "ru" ? "Версия восстановлена как новая." : "Нұсқа жаңа нұсқа ретінде қалпына келтірілді."
      : locale === "ru" ? "Не удалось восстановить версию. Обновите страницу и попробуйте снова." : "Нұсқаны қалпына келтіру мүмкін болмады. Бетті жаңартып, қайта көріңіз."
    : null;
  return <form action={action}><input name="organizationId" type="hidden" value={organizationId} /><input name="expectedVersion" type="hidden" value={expectedVersion} /><input name="version" type="hidden" value={version} /><button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60" disabled={pending || version === expectedVersion} type="submit">{pending ? (locale === "ru" ? "Восстанавливаем…" : "Қалпына келтірілуде…") : (locale === "ru" ? "Восстановить как новую версию" : "Жаңа нұсқа ретінде қалпына келтіру")}</button>{message ? <p className={`mt-2 text-xs ${state.status === "error" ? "text-rose-700" : "text-emerald-700"}`}>{message}</p> : null}</form>;
}
