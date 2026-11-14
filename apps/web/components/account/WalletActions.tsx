"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isAddress } from "viem";
import {
  CircleClientError,
  connectWallet,
  ensureWallet,
  executeChallenge,
  getOrRefreshSession,
  logout,
} from "@/lib/circle-client";
import { errorText } from "@/lib/error-text";
import { shortAddr } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { ItineraryView } from "@/lib/types";
import { parseVenue } from "@/lib/venue-qr";
import Icon, { type IconName } from "../Icon";
import { useI18n } from "../I18nProvider";
import QRVoucher from "../QRVoucher";
import Scanner from "../Scanner";
import { tripHref } from "./TripsClient";

type Prefill = { to: string; venue?: string };
type Sheet = { kind: "send"; prefill?: Prefill } | { kind: "receive" } | { kind: "scan" } | null;

class ApiFail extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } }).error;
    throw new ApiFail(e?.code ?? "INTERNAL", e?.message ?? `HTTP ${res.status}`);
  }
  return j as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A wallet address from a QR: a bare 0x… or an EIP-681 "ethereum:0x…" link. */
function parseAddressQr(text: string): string | null {
  const m = text.trim().match(/^(?:ethereum:)?(0x[0-9a-fA-F]{40})(?:@\d+)?(?:[/?].*)?$/);
  return m && isAddress(m[1]) ? m[1] : null;
}

/** Bottom sheet on phones, centered dialog from 768px. */
function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[24px] border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:max-w-md md:rounded-[24px] md:pb-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-extrabold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="-mr-2 min-h-10 rounded-lg px-3 text-sm text-ink-2 hover:text-white">
            {t.closeAction}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type SendState =
  | { step: "form"; error?: string }
  | { step: "confirm" }
  | { step: "working"; text: string }
  | { step: "done"; amount: string; url: string | null }
  | { step: "pending" }
  | { step: "error"; message: string };

function SendSheet({ prefill, balanceRaw, onClose, onSent }: { prefill?: Prefill; balanceRaw: string | null; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const [to, setTo] = useState(prefill?.to ?? "");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<SendState>({ step: "form" });
  const balance = balanceRaw !== null ? Number(balanceRaw) : null;
  const clean = amount.trim().replace(",", ".");

  const review = () => {
    if (!isAddress(to.trim())) return setState({ step: "form", error: t.sendBadAddress });
    if (!/^\d{1,7}(\.\d{1,6})?$/.test(clean) || !(Number(clean) > 0)) return setState({ step: "form", error: t.sendBadAmount });
    if (balance !== null && Number(clean) > balance) return setState({ step: "form", error: t.sendTooMuch });
    setState({ step: "confirm" });
  };

  const send = async () => {
    setState({ step: "working", text: t.sendOpening });
    try {
      let session = await getOrRefreshSession().catch(() => null);
      if (!session) {
        session = await connectWallet("/wallet");
        if (!session) return; // Google mode: redirected to sign in
      }
      if (!session.walletAddress) session = await ensureWallet(session);
      const r = await api<{ challengeId: string; from: string; to: string; fromBlock: string }>("/api/wallet/send", {
        method: "POST",
        body: JSON.stringify({ userToken: session.userToken, to: to.trim(), amount: clean }),
      });
      await executeChallenge(session, r.challengeId);
      setState({ step: "working", text: t.sendConfirming });
      const q = new URLSearchParams({ from: r.from, to: r.to, fromBlock: r.fromBlock });
      for (let i = 0; i < 45; i++) {
        const s = await api<{ found: boolean; amountUsdc?: string; explorerTxUrl?: string | null }>(`/api/wallet/transfer?${q}`);
        if (s.found) {
          setState({ step: "done", amount: s.amountUsdc ?? clean, url: s.explorerTxUrl ?? null });
          onSent();
          return;
        }
        await sleep(2000);
      }
      setState({ step: "pending" });
      onSent();
    } catch (err) {
      const code = err instanceof ApiFail || err instanceof CircleClientError ? err.code : "NETWORK";
      if (code === "UNAUTHORIZED") logout();
      setState({ step: "error", message: code === "NETWORK" ? t.err.NETWORK : errorText(t, code, (err as Error).message) });
    }
  };

  const title = prefill?.venue ? t.sendToVenue.replace("{name}", prefill.venue) : t.sendTitle;
  const inputCls =
    "h-12 w-full min-w-0 rounded-xl border border-[#2c4b45] bg-bg px-3 text-base text-white outline-none placeholder:text-[#5f7a73] focus:border-accent";

  return (
    <SheetFrame title={title} onClose={onClose}>
      {state.step === "form" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            review();
          }}
          className="space-y-4"
        >
          {prefill?.venue && <p className="rounded-xl bg-accent-soft px-3 py-2 text-xs text-[#c5d8d1]">{t.sendVenueNote}</p>}
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-ink-2">{t.sendTo}</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              readOnly={!!prefill?.venue}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono text-sm`}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs font-semibold text-ink-2">
              {t.sendAmount}
              {balance !== null && <span className="font-normal">{t.sendAvailable.replace("{amount}", balance.toFixed(2))}</span>}
            </span>
            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                className={`${inputCls} tabular-nums`}
              />
              {balance !== null && balance > 0.01 && (
                <button
                  type="button"
                  onClick={() => setAmount((Math.floor((balance - 0.01) * 100) / 100).toFixed(2))}
                  className="min-h-12 shrink-0 rounded-xl border border-[#2c4b45] px-3 text-sm font-semibold text-accent hover:border-accent"
                >
                  {t.sendMax}
                </button>
              )}
            </div>
          </label>
          {state.error && (
            <p role="alert" className="rounded-lg bg-[#ff8a7f]/15 px-3 py-2 text-sm text-[#ffb3ab]">
              {state.error}
            </p>
          )}
          <button type="submit" className="min-h-12 w-full rounded-xl bg-accent text-base font-bold text-accent-ink hover:brightness-110">
            {t.sendContinue} →
          </button>
        </form>
      )}

      {state.step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-bg p-4 text-center">
            <div className="text-xs text-ink-2">{t.sendConfirmTitle}</div>
            <div className="mt-1 font-display text-3xl font-extrabold text-white tabular-nums">{clean} USDC</div>
            <div className="mt-2 text-sm text-[#c5d8d1]">→ {prefill?.venue ?? shortAddr(to.trim())}</div>
            <div className="mt-1 font-mono text-[11px] break-all text-ink-2">{to.trim()}</div>
          </div>
          <p className="text-xs leading-relaxed text-warn">{t.sendConfirmBody}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setState({ step: "form" })} className="min-h-12 rounded-xl border border-white/15 text-sm font-bold text-white">
              {t.sendBack}
            </button>
            <button type="button" onClick={() => void send()} className="min-h-12 rounded-xl bg-accent text-sm font-bold text-accent-ink hover:brightness-110">
              {t.sendConfirmCta}
            </button>
          </div>
        </div>
      )}

      {state.step === "working" && <p className="animate-pulse py-6 text-center text-sm text-[#c5d8d1]">{state.text}</p>}

      {state.step === "done" && (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-2xl text-accent">✓</div>
          <p className="font-display text-xl font-extrabold text-white">{t.sendDone.replace("{amount}", state.amount)}</p>
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">
              {t.sendViewTx} ↗
            </a>
          )}
          <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-accent text-sm font-bold text-accent-ink">
            {t.closeAction}
          </button>
        </div>
      )}

      {state.step === "pending" && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.sendPending}</p>}

      {state.step === "error" && (
        <div className="space-y-3">
          <p role="alert" className="rounded-lg bg-[#ff8a7f]/15 px-3 py-2 text-sm text-[#ffb3ab]">
            {state.message}
          </p>
          <button type="button" onClick={() => setState({ step: "form" })} className="min-h-12 w-full rounded-xl border border-white/15 text-sm font-bold text-white">
            {t.sendBack}
          </button>
        </div>
      )}
    </SheetFrame>
  );
}

function ReceiveSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <SheetFrame title={t.receiveTitle} onClose={onClose}>
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <QRVoucher payload={address} label={t.receiveTitle} hint={t.receiveQrHint} showText={false} />
        </div>
        <p className="font-mono text-xs break-all text-[#c5d8d1]">{address}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(address).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="min-h-12 w-full rounded-xl bg-accent text-sm font-bold text-accent-ink"
        >
          {copied ? `✓ ${t.copied}` : t.copy}
        </button>
        <p className="text-xs leading-relaxed text-ink-2">{t.receiveBody}</p>
      </div>
    </SheetFrame>
  );
}

function ScanSheet({ active, onClose, onSend }: { active: ItineraryView[]; onClose: () => void; onSend: (p: Prefill) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);
  const [paste, setPaste] = useState("");
  const handled = useRef(false);

  const handle = async (text: string) => {
    if (handled.current) return;
    handled.current = true;
    const venueId = parseVenue(text);
    if (venueId) {
      // A venue on one of your trips: let the trip page pay that stop (prepaid release or bill).
      const trip = active.find((it) => it.stops.some((s) => s.status === "PENDING" && s.merchant?.id === venueId));
      if (trip) {
        setMessage({ text: t.scanOpeningTrip, ok: true });
        router.push(`${tripHref(trip.id)}?venue=${encodeURIComponent(venueId)}`);
        return;
      }
      try {
        const { merchants } = await api<{ merchants: { id: string; name: string; walletAddress: string }[] }>("/api/merchant");
        const m = merchants.find((x) => x.id === venueId);
        if (m) return onSend({ to: m.walletAddress, venue: merchantName(t, m) || m.name });
      } catch {
        /* fall through */
      }
      handled.current = false;
      return setMessage({ text: t.scanUnknown });
    }
    const addr = parseAddressQr(text);
    if (addr) return onSend({ to: addr });
    handled.current = false;
    setMessage({ text: /^toura:\/\/checkin\?/.test(text.trim()) ? t.scanGuestCode : t.scanUnknown });
  };

  return (
    <SheetFrame title={t.scanTitle} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-[#c5d8d1]">{t.scanHint}</p>
        <Scanner onScan={(s) => void handle(s)} autoStart label={t.scanTitle} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (paste.trim()) void handle(paste);
          }}
          className="flex gap-2"
        >
          <input
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={t.scanPasteAny}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full min-w-0 rounded-xl border border-[#2c4b45] bg-bg px-3 text-sm text-white outline-none placeholder:text-[#5f7a73] focus:border-accent"
          />
          <button type="submit" className="min-h-11 shrink-0 rounded-xl border border-[#2c4b45] px-4 text-sm font-semibold text-accent">
            {t.scanUse}
          </button>
        </form>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-accent-soft text-accent" : "bg-[#ff8a7f]/15 text-[#ffb3ab]"}`}>
            {message.text}
          </p>
        )}
      </div>
    </SheetFrame>
  );
}

/** Send · Receive · Scan · Top up, under the wallet balance. */
export default function WalletActions({
  address,
  balanceRaw,
  faucetUrl,
  active,
  onChanged,
}: {
  address: string | null;
  balanceRaw: string | null;
  faucetUrl: string;
  active: ItineraryView[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);

  const actions: { icon: IconName; label: string; onClick?: () => void; href?: string }[] = [
    { icon: "send", label: t.walletSend, onClick: () => setSheet({ kind: "send" }) },
    { icon: "receive", label: t.walletReceive, onClick: () => setSheet({ kind: "receive" }) },
    { icon: "scan", label: t.walletScan, onClick: () => setSheet({ kind: "scan" }) },
    { icon: "plus", label: t.walletTopUpShort, href: faucetUrl },
  ];

  return (
    <>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {actions.map((a) => {
          const inner = (
            <>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent text-accent-ink transition-transform group-hover:-translate-y-0.5">
                <Icon name={a.icon} size={20} strokeWidth={2} />
              </span>
              <span className="text-xs font-semibold text-[#dffff4]">{a.label}</span>
            </>
          );
          const cls = "group flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl hover:bg-white/[0.05] disabled:opacity-50";
          return a.href ? (
            <a key={a.label} href={a.href} target="_blank" rel="noreferrer" className={cls}>
              {inner}
            </a>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} disabled={!address} className={cls}>
              {inner}
            </button>
          );
        })}
      </div>

      {sheet?.kind === "send" && <SendSheet prefill={sheet.prefill} balanceRaw={balanceRaw} onClose={close} onSent={onChanged} />}
      {sheet?.kind === "receive" && address && <ReceiveSheet address={address} onClose={close} />}
      {sheet?.kind === "scan" && <ScanSheet active={active} onClose={close} onSend={(prefill) => setSheet({ kind: "send", prefill })} />}
    </>
  );
}
