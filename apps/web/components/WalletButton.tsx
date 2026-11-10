"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { circleConfigured, getSession, logout, startGoogleLogin, type CircleSession } from "@/lib/circle-client";
import { shortAddr } from "@/lib/format";
import { useI18n } from "./I18nProvider";

/** Real Circle wallet state (Google login). Shows the Arc wallet address once connected. */
export default function WalletButton() {
  const { t } = useI18n();
  const path = usePathname();
  const [session, setSession] = useState<CircleSession | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setSession(getSession()), [path]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const connected = !!session?.walletAddress;

  const onClick = async () => {
    if (connected) {
      setOpen((o) => !o);
      return;
    }
    if (!circleConfigured()) {
      setNote(t.walletNotConfigured);
      setTimeout(() => setNote(null), 3500);
      return;
    }
    try {
      await startGoogleLogin(path || "/");
    } catch (err) {
      setNote((err as Error).message);
      setTimeout(() => setNote(null), 3500);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => void onClick()}
        className="flex min-h-[40px] items-center rounded-xl border border-[#295047] bg-[#12312b] px-3 text-xs font-bold text-[#dffff4] md:px-4 md:text-sm"
      >
        {connected && <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-accent" />}
        {connected ? shortAddr(session!.walletAddress!) : t.connectWallet}
      </button>
      {open && connected && (
        <div className="absolute right-0 mt-2 w-60 space-y-2 rounded-2xl border border-line bg-surface p-3 text-sm shadow-2xl">
          <div className="text-[10px] font-bold tracking-widest text-ink-2">ARC TESTNET · CIRCLE</div>
          <button
            type="button"
            className="w-full truncate text-left font-mono text-xs text-ink hover:text-accent"
            onClick={() => navigator.clipboard?.writeText(session!.walletAddress!)}
            title={t.copy}
          >
            {session!.walletAddress} ⧉
          </button>
          {session?.email && <div className="truncate text-xs text-ink-2">{session.email}</div>}
          <button
            type="button"
            onClick={() => {
              logout();
              setSession(null);
              setOpen(false);
            }}
            className="w-full rounded-lg bg-surface-2 py-2 text-xs font-semibold text-ink hover:text-accent"
          >
            {t.logout}
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
