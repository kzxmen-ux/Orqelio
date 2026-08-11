"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n/config";

export function CopyDiagnosticReferenceButton({
  locale,
  reference,
}: {
  locale: Locale;
  reference: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label={locale === "ru" ? `Скопировать ${reference}` : `${reference} көшіру`}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      onClick={copyReference}
      type="button"
    >
      {copied
        ? locale === "ru" ? "Скопировано" : "Көшірілді"
        : locale === "ru" ? "Копировать" : "Көшіру"}
    </button>
  );
}
