"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
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

  const items = [
    { href: "/#explore", hash: "#explore", icon: "⌂", label: t.tabDiscover },
    { href: "/#map", hash: "#map", icon: "⌖", label: t.tabMap },
    { href: "/#ask", hash: "#ask", icon: "✦", label: t.navAsk, primary: true },
    { href: "/#itinerary", hash: "#itinerary", icon: "◇", label: t.navTrips },
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
                <span className="-mt-5 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl text-accent-ink shadow-[0_8px_24px_#70efc044]">
                  {it.icon}
                </span>
              ) : (
                <span className="text-xl leading-none" aria-hidden>
                  {it.icon}
                </span>
              )}
              {it.label}
            </a>
          </li>
        ))}
        <li>
          <Link
            href="/dashboard"
            aria-current={path === "/dashboard" ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
              path === "/dashboard" ? "text-accent" : "text-ink-2"
            }`}
          >
            <span className="text-xl leading-none" aria-hidden>
              ◉
            </span>
            {t.navDashboard}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
