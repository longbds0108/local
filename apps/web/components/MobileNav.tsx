"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import Icon, { type IconName } from "./Icon";
import { useI18n } from "./I18nProvider";

/**
 * Thumb-reachable bottom navigation for phones (hidden ≥768px).
 * Hash links use plain <a> so the browser fires `hashchange` (HomeClient
 * listens for #map / #saved); re-tapping the current item re-triggers it.
 */
export default function MobileNav() {
  const { t } = useI18n();
  const path = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [path]);

  const items: { href: string; hash: string; icon: IconName; label: string; primary?: boolean }[] = [
    { href: "/#explore", hash: "#explore", icon: "compass", label: t.tabDiscover },
    { href: "/#map", hash: "#map", icon: "map", label: t.tabMap },
    { href: "/#ask", hash: "#ask", icon: "sparkles", label: t.navAsk, primary: true },
  ];
  const pages: { href: string; icon: IconName; label: string; active: boolean }[] = [
    { href: "/trips", icon: "luggage", label: t.navTripsPage, active: !!path?.startsWith("/trips") },
    { href: "/wallet", icon: "wallet", label: t.navWallet, active: path === "/wallet" },
  ];

  const onHashClick = (e: MouseEvent<HTMLAnchorElement>, h: string) => {
    if (window.location.pathname === "/" && window.location.hash === h) {
      e.preventDefault();
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      if (h !== "#map") document.getElementById(h.slice(1))?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const active = (h: string) => path === "/" && (hash === h || (!hash && h === "#explore"));

  return (
    <nav
      aria-label={t.mainNav}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map((it) => (
          <li key={it.href}>
            <a
              href={it.href}
              onClick={(e) => onHashClick(e, it.hash)}
              aria-current={active(it.hash) ? "page" : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                active(it.hash) ? "text-accent" : "text-ink-2"
              }`}
            >
              {it.primary ? (
                <span className="-mt-5 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-accent-ink shadow-[0_8px_24px_#70efc044]">
                  <Icon name={it.icon} size={24} strokeWidth={2} />
                </span>
              ) : (
                <Icon name={it.icon} size={22} />
              )}
              {it.label}
            </a>
          </li>
        ))}
        {pages.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              aria-current={p.active ? "page" : undefined}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${p.active ? "text-accent" : "text-ink-2"}`}
            >
              <Icon name={p.icon} size={22} />
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
