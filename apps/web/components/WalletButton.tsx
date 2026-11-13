"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  authMode,
  CircleClientError,
  circleConfigured,
  connectWallet,
  getOrRefreshSession,
  getSession,
  hasPinWallet,
  logout,
  SESSION_EVENT,
  type CircleSession,
} from "@/lib/circle-client";
import { shortAddr } from "@/lib/format";
import { useI18n } from "./I18nProvider";
import Icon from "./Icon";
import { errorText } from "@/lib/error-text";

/**
 * Header wallet button. PIN mode (no Google client id configured): connects a
 * Circle wallet tied to this browser — Circle's own UI asks for a PIN.
 * Google mode: redirects to Google sign-in.
 */
export default function WalletButton() {
  const { t } = useI18n();
  const path = usePathname();
  const [session, setSession] = useState<CircleSession | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Keep in sync with connects/disconnects anywhere on the page; silently renew PIN sessions.
  useEffect(() => {
    const read = () => setSession(getSession());
    read();
    if (!getSession() && hasPinWallet()) void getOrRefreshSession().then((s) => s && setSession(s)).catch(() => {});
    window.addEventListener(SESSION_EVENT, read);
    return () => window.removeEventListener(SESSION_EVENT, read);
  }, [path]);

  useEffect(() => {
    if (!open || !session?.walletAddress) return;
    fetch(`/api/balance?address=${session.walletAddress}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBalance(Number(j.usdc).toFixed(2)))
      .catch(() => {});
  }, [open, session?.walletAddress]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 4000);
  };

  const connected = !!session?.walletAddress;

  const onClick = async () => {
    if (connected) {
      setOpen((o) => !o);
      return;
    }
    if (!circleConfigured()) {
      flash(t.walletNotConfigured);
      return;
    }
    setBusy(true);
    try {
      const s = await connectWallet(path || "/");
      if (s) setSession(s);
    } catch (err) {
      const code = err instanceof CircleClientError ? err.code : "";
      flash(errorText(t, code, (err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="flex min-h-11 items-center rounded-xl border border-[#295047] bg-[#12312b] px-2.5 text-xs font-bold whitespace-nowrap text-[#dffff4] tabular-nums disabled:opacity-70 min-[400px]:px-3 md:px-4 md:text-sm"
      >
        {connected && <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent" />}
        {busy ? t.connecting : connected ? shortAddr(session!.walletAddress!) : t.connectWallet}
      </button>
      {open && connected && (
        <div className="absolute right-0 mt-2 w-64 space-y-2 rounded-2xl border border-line bg-surface p-3 text-sm shadow-2xl">
          <div className="text-[11px] font-bold tracking-widest text-ink-2">{t.networkLabel}</div>
          <button
            type="button"
            className="min-h-10 w-full truncate text-left tabular-nums text-xs text-ink hover:text-accent"
            onClick={() => navigator.clipboard?.writeText(session!.walletAddress!)}
            title={t.copy}
          >
            {session!.walletAddress} ⧉
          </button>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-ink-2">{t.balance}</span>
            <b>{balance !== null ? `${balance} USDC` : "…"}</b>
          </div>
          {session?.email && <div className="truncate text-xs text-ink-2">{session.email}</div>}
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/trips"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-bold text-accent-ink"
            >
              <Icon name="luggage" size={16} /> {t.navTripsPage}
            </Link>
            <Link
              href="/wallet"
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-surface-2 text-xs font-bold text-ink"
            >
              <Icon name="wallet" size={16} /> {t.navWallet}
            </Link>
          </div>
          {authMode() === "pin" && <p className="text-[11px] leading-snug text-ink-2">{t.walletBrowserNote}</p>}
          <a
            href={process.env.NEXT_PUBLIC_FAUCET_URL || "https://faucet.circle.com"}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-10 items-center text-xs font-semibold text-accent underline"
          >
            🚰 {t.faucet} ↗
          </a>
          <button
            type="button"
            onClick={() => {
              logout();
              setSession(null);
              setOpen(false);
            }}
            className="min-h-10 w-full rounded-lg bg-surface-2 text-xs font-semibold text-ink hover:text-accent"
          >
            {authMode() === "pin" ? t.disconnect : t.logout}
          </button>
        </div>
      )}
      {note && (
        <div role="status" className="absolute right-0 mt-2 w-64 rounded-xl bg-[#e4fff5] p-3 text-xs text-[#083a2d] shadow-2xl">
          {note}
        </div>
      )}
    </div>
  );
}
