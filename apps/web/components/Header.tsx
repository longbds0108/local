"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n, LangToggle } from "./I18nProvider";
import WalletButton from "./WalletButton";

export default function Header() {
  const { t } = useI18n();
  const path = usePathname();
  const nav = [
    { href: "/#explore", label: t.navExplore },
    { href: "/#itinerary", label: t.navTrips },
    { href: "/merchant", label: t.navMerchant },
  ];
  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between gap-3 border-b border-line bg-bg/85 px-[18px] backdrop-blur-xl md:px-[5vw]">
      <Link href="/" className="flex items-center gap-2.5 text-white">
        <span className="grid h-[34px] w-[34px] -rotate-6 place-items-center rounded-[10px] bg-accent font-display text-lg font-extrabold text-accent-ink">
          H
        </span>
        <span className="font-display text-lg font-extrabold md:text-xl">Hedgora</span>
        <small className="hidden text-[10px] font-medium text-ink-2 sm:block">{t.brandTagline}</small>
      </Link>
      <nav className="hidden items-center gap-8 md:flex">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`text-sm ${path === n.href ? "text-accent" : "text-[#a7bbb5] hover:text-white"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/merchant" className="text-xs text-[#a7bbb5] md:hidden">
          {t.navMerchant}
        </Link>
        <LangToggle />
        <WalletButton />
      </div>
    </header>
  );
}
