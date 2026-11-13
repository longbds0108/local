"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";

export default function NotFoundClient() {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-[560px] flex-col items-center justify-center px-[18px] py-16 text-center">
      <div className="font-display text-[64px] leading-none font-extrabold text-accent">404</div>
      <h1 className="mt-4 font-display text-2xl font-extrabold text-white md:text-3xl">{t.notFoundTitle}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#a7bbb5]">{t.notFoundBody}</p>
      <Link href="/" className="mt-7 inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-bold text-accent-ink hover:brightness-110">
        {t.notFoundCta} <span aria-hidden className="ml-1.5">→</span>
      </Link>
    </div>
  );
}
