"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "../I18nProvider";

export const TZ = "Asia/Ho_Chi_Minh";

export const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

/** dd/mm in both languages (vi-VN formats with "-" or "."). */
export function dayMonth(iso: string, locale: "vi" | "en"): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" })
    .format(new Date(iso))
    .replace(/[-.]/g, "/");
}

export function weekday(iso: string, locale: "vi" | "en"): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(iso));
}

export function DateBlock({ iso, size = "md" }: { iso: string; size?: "md" | "lg" }) {
  const { locale } = useI18n();
  const box = size === "lg" ? "h-16 w-16" : "h-14 w-14";
  return (
    <div className={`grid ${box} shrink-0 place-items-center rounded-2xl bg-surface-2 text-center leading-tight`}>
      <div>
        <div className="text-[11px] font-bold text-ink-2 uppercase">{weekday(iso, locale)}</div>
        <div className="font-display text-sm font-extrabold text-white">{dayMonth(iso, locale)}</div>
      </div>
    </div>
  );
}

/** Page shell for the traveller's own pages (/trips, /wallet). */
export function AccountPage({ title, subtitle, aside, children }: { title: string; subtitle: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative overflow-x-clip">
      <div className="glow -top-[260px] -right-[100px] bg-[#28d7a4]" aria-hidden />
      <div className="mx-auto max-w-[760px] space-y-6 px-[18px] pt-6 pb-10 md:px-8 md:pt-10">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-[28px] leading-tight font-extrabold text-white md:text-[36px]">{title}</h1>
            <p className="mt-1 text-sm text-ink-2">{subtitle}</p>
          </div>
          {aside}
        </header>
        {children}
      </div>
    </div>
  );
}

export function ConnectCard({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  const { t } = useI18n();
  return (
    <section className="rounded-[24px] border border-line bg-surface p-6 text-center md:p-10">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#86ffd2] to-[#1ab884] text-2xl text-[#073526]">✦</div>
      <h2 className="mt-4 font-display text-xl font-extrabold text-white">{t.dashConnectTitle}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">{t.dashConnectBody}</p>
      <button
        type="button"
        onClick={onConnect}
        disabled={connecting}
        className="mt-5 min-h-12 rounded-xl bg-accent px-6 text-base font-bold text-accent-ink disabled:opacity-60"
      >
        {connecting ? t.connecting : t.connectWallet}
      </button>
    </section>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
      {text}
    </p>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
      ← {label}
    </Link>
  );
}
