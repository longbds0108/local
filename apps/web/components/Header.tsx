"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n, LangToggle } from "./I18nProvider";
import WalletButton from "./WalletButton";

export default function Header() {
  const { t } = useI18n();
  const path = usePathname();
  // Traveller destinations only; the partner portal is linked from the footer.
  const nav = [
    { href: "/", label: t.navExplore, active: path === "/" },
    { href: "/trips", label: t.navTripsPage, active: path?.startsWith("/trips") },
    { href: "/wallet", label: t.navWallet, active: path === "/wallet" },
  ];
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center md:h-[72px] justify-between gap-2 border-b border-line bg-bg/85 px-[18px] min-[400px]:gap-3 backdrop-blur-xl md:px-[5vw]">
      <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 text-white min-[400px]:gap-2.5">
        <span className="grid h-[34px] w-[34px] -rotate-6 place-items-center rounded-[10px] bg-accent font-display text-lg font-extrabold text-accent-ink">
          P
        </span>
        <span className="font-display text-base font-extrabold tracking-tight whitespace-nowrap min-[400px]:text-lg md:text-xl">PAY AGENT</span>
        <small className="hidden text-[11px] font-medium text-ink-2 sm:block">{t.brandTagline}</small>
      </Link>
      <nav className="hidden items-center gap-8 md:flex">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={n.active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center text-sm ${n.active ? "font-semibold text-accent" : "text-[#a7bbb5] hover:text-white"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-1.5 min-[400px]:gap-2">
        <LangToggle />
        <WalletButton />
      </div>
    </header>
  );
}
