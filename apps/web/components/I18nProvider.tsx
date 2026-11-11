"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { dictionaries, type Dict, type Locale } from "@/lib/i18n";

type Ctx = { locale: Locale; t: Dict; setLocale: (l: Locale) => void };

const I18nContext = createContext<Ctx>({ locale: "vi", t: dictionaries.vi, setLocale: () => {} });

const KEY = "payagent.locale";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("vi");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "vi" || saved === "en") setLocaleState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // Tab title in the UI language (React hoists <title> into <head>).
  const section = "/" + (pathname?.split("/")[1] ?? "");
  const pageName = dictionaries[locale].pageTitle[section];
  const title = pageName ? `${pageName} · PAY AGENT` : "PAY AGENT";

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t: dictionaries[locale], setLocale }}>
      <title>{title}</title>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LangToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "vi" ? "en" : "vi")}
      className="min-h-[40px] min-w-[44px] rounded-xl border border-line px-3 text-xs font-semibold text-ink-2 hover:text-white"
      aria-label={t.switchLang}
    >
      {t.langToggle}
    </button>
  );
}
