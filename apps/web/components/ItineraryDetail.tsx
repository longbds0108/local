"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CircleClientError, ensureWallet, getSession, logout, startGoogleLogin } from "@/lib/circle-client";
import { CATEGORY_EMOJI, hhmm, usdc } from "@/lib/format";
import type { ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "./I18nProvider";
import { PriceLabel } from "./ItineraryCard";
import QRVoucher from "./QRVoucher";

type Props = { initial: ItineraryView; vouchers: Record<string, string>; explorerUrl: string | null };

const STATUS_STYLE: Record<string, string> = {
  FREE: "bg-surface-2 text-ink-2",
  PENDING: "bg-accent-soft text-accent",
  CHECKED_IN: "bg-warn-soft text-warn",
  REFUNDING: "bg-warn-soft text-warn",
  RELEASED: "bg-ok-soft text-ok",
  REFUNDED: "bg-surface-2 text-ink-2",
};

function TxLink({ hash, explorerUrl, label }: { hash: string; explorerUrl: string | null; label: string }) {
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return explorerUrl ? (
    <a href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">
      {label}: {short} ↗
    </a>
  ) : (
    <span className="text-xs text-ink-2">
      {label}: {short}
    </span>
  );
}

export default function ItineraryDetail({ initial, vouchers, explorerUrl }: Props) {
  const { t } = useI18n();
  const [it, setIt] = useState(initial);
  const [busyStop, setBusyStop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read after mount (localStorage) to avoid a hydration mismatch.
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => setHasSession(!!getSession()), []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/itinerary?id=${encodeURIComponent(it.id)}`, { cache: "no-store" });
    if (res.ok) setIt(((await res.json()) as { itinerary: ItineraryView }).itinerary);
  }, [it.id]);

  // Poll while something can still change (merchant check-in, refunds).
  useEffect(() => {
    const live = it.stops.some((s) => ["PENDING", "CHECKED_IN", "REFUNDING"].includes(s.status)) && it.status === "PAID";
    if (!live) return;
    const timer = setInterval(() => void refresh(), 8000);
    return () => clearInterval(timer);
  }, [it, refresh]);

  const cancel = async (stop: StopView) => {
    setError(null);
    let session = getSession();
    if (!session) {
      await startGoogleLogin(`/itinerary/${it.id}`).catch((e: Error) => setError(e.message));
      return;
    }
    if (!window.confirm(t.cancelConfirm)) return;
    setBusyStop(stop.id);
    try {
      if (!session.walletAddress) session = await ensureWallet(session);
      const res = await fetch("/api/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cancel", stopId: stop.id, userToken: session.userToken }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (j as { error?: { code?: string; message?: string } }).error?.code ?? "TX_FAILED";
        if (code === "UNAUTHORIZED") logout();
        throw new CircleClientError(code, (j as { error?: { message?: string } }).error?.message ?? "");
      }
      await refresh();
    } catch (err) {
      const code = err instanceof CircleClientError ? err.code : "TX_FAILED";
      setError(t.err[code] ?? (err as Error).message);
    } finally {
      setBusyStop(null);
    }
  };

  const paid = it.status !== "DRAFT";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5">
      <Link href="/" className="text-sm text-accent hover:underline">
        {t.backToMap}
      </Link>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-ink">{it.title}</h1>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{t.status[it.status]}</span>
        </div>
        <p className="text-sm text-ink-2">
          {hhmm(it.startAt)}–{hhmm(it.endAt)} · {it.partySize} {t.people} · {t.total} {usdc(it.totalUsdc)}
        </p>
        {it.depositTxHash && <TxLink hash={it.depositTxHash} explorerUrl={explorerUrl} label="Deposit" />}
        <p className="text-xs text-warn">⚠️ {t.testnetBadge}</p>
      </header>

      {!paid && (
        <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink">
          {t.notPaidYet}{" "}
          <Link href={`/pay/${it.id}`} className="font-semibold text-accent underline">
            {t.goPay}
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <ol className="space-y-3">
        {it.stops.map((s, i) => (
          <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold text-ink">
                  {i + 1}. {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
                </h2>
                <p className="text-xs text-ink-2">
                  {hhmm(s.arriveAt)} · {s.durationMin} {t.minutes}
                  {s.merchant && Number(s.priceUsdc) > 0 ? ` · ${s.merchant.name}` : ""}
                </p>
              </div>
              <PriceLabel price={s.priceUsdc} source={s.priceSource} />
            </div>
            <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[s.status] ?? ""}`}>
              {t.stopStatus[s.status]}
            </span>

            {paid && s.status === "PENDING" && vouchers[s.id] && (
              <div className="mt-3 space-y-2">
                <QRVoucher payload={vouchers[s.id]} label={s.name} />
                {it.status === "PAID" && (
                  <button
                    type="button"
                    disabled={busyStop !== null}
                    onClick={() => void cancel(s)}
                    className="w-full rounded-xl border border-danger/40 px-3 py-2 text-sm font-medium text-danger disabled:opacity-50"
                  >
                    {busyStop === s.id ? t.loading : hasSession ? t.cancelStop : t.cancelLogin}
                  </button>
                )}
              </div>
            )}
            {s.status === "FREE" && paid && <p className="mt-2 text-xs text-ink-2">{t.noVoucherFree}</p>}
            <div className="mt-2 flex flex-col gap-1">
              {s.releaseTx && <TxLink hash={s.releaseTx} explorerUrl={explorerUrl} label="Release" />}
              {s.refundTx && <TxLink hash={s.refundTx} explorerUrl={explorerUrl} label="Refund" />}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
