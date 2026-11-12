"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "./I18nProvider";
import Logo from "./Logo";

const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL || "https://faucet.circle.com";

export default function Footer() {
  const { t } = useI18n();
  const path = usePathname();
  const onPartnerPortal = path === "/merchant";

  const links = [
    { href: "/", label: t.navExplore },
    { href: "/#ask", label: t.navAsk },
    { href: "/trips", label: t.navTripsPage },
    { href: "/wallet", label: t.navWallet },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-line bg-[#040f0d]">
      {/* Soft ambient glow, like the hero. */}
      <div aria-hidden className="pointer-events-none absolute -top-24 right-[-60px] h-64 w-64 rounded-full bg-accent opacity-[0.05] blur-3xl" />

      <div className="relative mx-auto grid max-w-[1440px] gap-10 px-[18px] pt-12 pb-8 md:grid-cols-[1.35fr_.65fr_1.1fr] md:gap-[5vw] md:px-[7vw] md:pt-16">
        <div className="max-w-[420px]">
          <Link href="/" aria-label="Toura" className="inline-flex min-h-11 items-center">
            <Logo />
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-[#a7bbb5]">{t.footerAbout}</p>
          <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#25423d] bg-[#0b211e] px-3 py-1.5 text-[11px] font-semibold text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F28C38]" aria-hidden />
            {t.testnetBadge}
          </p>
        </div>

        <nav aria-label={t.footerTravel}>
          <h2 className="text-[11px] font-extrabold tracking-[2px] text-accent uppercase">{t.footerTravel}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 md:grid-cols-1">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-sm text-[#cfe0da] hover:text-white">
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="col-span-2 md:col-span-1">
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-sm text-[#cfe0da] hover:text-white"
              >
                {t.faucet} <span aria-hidden>↗</span>
              </a>
            </li>
          </ul>
        </nav>

        {!onPartnerPortal && (
          <div className="self-start rounded-[22px] border border-[#25423d] bg-[#0b211e] p-5 md:p-6">
            <h2 className="font-display text-lg font-extrabold text-white">{t.footerPartnerTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#a7bbb5]">{t.footerPartnerBody}</p>
            <Link
              href="/merchant"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink hover:brightness-110"
            >
              {t.partnerLink} <span aria-hidden className="ml-1.5">→</span>
            </Link>
          </div>
        )}
      </div>

      <div className="relative mx-auto flex max-w-[1440px] flex-col gap-2 border-t border-line px-[18px] py-5 text-xs text-ink-2 md:flex-row md:items-center md:justify-between md:px-[7vw]">
        <span>© {new Date().getFullYear()} Toura</span>
        <span>
          {t.footerMapData} ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-white/20 underline-offset-2 hover:text-white"
          >
            OpenStreetMap
          </a>
        </span>
      </div>
    </footer>
  );
}
