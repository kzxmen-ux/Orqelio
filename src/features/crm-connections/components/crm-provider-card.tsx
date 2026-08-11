import Link from "next/link";
import type { ReactNode } from "react";

type CrmProviderCardProps = {
  actionLabel: string;
  action?: ReactNode;
  badge: string;
  description: string;
  href?: string;
  monogram: string;
  name: string;
  meta?: string;
};

export function CrmProviderCard({
  actionLabel,
  action,
  badge,
  description,
  href,
  monogram,
  name,
  meta,
}: CrmProviderCardProps) {
  return (
    <article className="flex min-h-64 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-indigo-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-2xl bg-slate-950 text-sm font-bold tracking-tight text-white"
        >
          {monogram}
        </span>
        <span
          className={
            href || action
              ? "rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700"
              : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500"
          }
        >
          {badge}
        </span>
      </div>

      <div className="mt-6 flex-1">
        <h3 className="text-xl font-semibold text-slate-950">{name}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        {meta ? <p className="mt-3 text-xs font-medium text-slate-500">{meta}</p> : null}
      </div>

      {action ?? (href ? (
        <Link
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          href={href}
        >
          {actionLabel}
        </Link>
      ) : (
        <button
          className="mt-6 w-full cursor-not-allowed rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400"
          disabled
          type="button"
        >
          {actionLabel}
        </button>
      ))}
    </article>
  );
}
