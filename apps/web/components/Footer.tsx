"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";

/** Quiet footer: the partner portal is for venues, so it sits outside the traveller menus. */
export default function Footer() {
  const { t } = useI18n();
  const path = usePathname();
  if (path === "/merchant") return null;
  return (
    <footer className="border-t border-line px-[18px] py-6 text-center text-xs text-ink-2">
      {t.partnerFooter}{" "}
      <Link href="/merchant" className="inline-flex min-h-10 items-center font-semibold text-accent underline">
        {t.partnerLink} →
      </Link>
    </footer>
  );
}
