"use client";

import { useCallback, useEffect, useState } from "react";
import { authMode, CircleClientError, connectWallet, ensureWallet, getOrRefreshSession, getSession, hasPinWallet, logout } from "@/lib/circle-client";
import { checkinPayload, codesFor } from "@/lib/checkin-codes";
import { errorText } from "@/lib/error-text";
import { CATEGORY_EMOJI, hhmm, usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { ItineraryView, StopView } from "@/lib/types";
import { stopState } from "../account/TripsClient";
import { useI18n } from "../I18nProvider";
import { PriceLabel } from "../ItineraryCard";
import QRVoucher from "../QRVoucher";

type Props = {
  it: ItineraryView;
  onChange: (it: ItineraryView) => void;
  explorerUrl: string | null;
};

/** Paid trip: the next stop's QR first, every stop's state, then the blockchain record. */
export default function VoucherPanel({ it, onChange, explorerUrl }: Props) {
  const { t } = useI18n();
  const [busyStop, setBusyStop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openQr, setOpenQr] = useState<string | null>(null);
  // QR payloads come from codes kept on this device (read after mount: localStorage).
  const [vouchers, setVouchers] = useState<Record<string, string>>({});
  useEffect(() => {
    const codes = codesFor(it.id);
    setVouchers(Object.fromEntries(Object.entries(codes).map(([stopId, code]) => [stopId, checkinPayload(stopId, code)])));
  }, [it.id]);
  // Read after mount (localStorage) to avoid a hydration mismatch.
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => setHasSession(!!getSession() || hasPinWallet()), []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/itinerary?id=${encodeURIComponent(it.id)}`, { cache: "no-store" });
    if (res.ok) onChange(((await res.json()) as { itinerary: ItineraryView }).itinerary);
  }, [it.id, onChange]);

  // Poll while a venue may scan a code or a refund is in flight.
  useEffect(() => {
    const live = it.status === "PAID" && it.stops.some((s) => ["PENDING", "CHECKED_IN", "REFUNDING"].includes(s.status));
    if (!live) return;
    const timer = setInterval(() => void refresh(), 8000);
    return () => clearInterval(timer);
  }, [it, refresh]);

  const cancel = async (stop: StopView) => {
    setError(null);
    let session = await getOrRefreshSession().catch(() => null);
    if (!session) {
      try {
        session = await connectWallet(`/trips/${it.id}`);
      } catch (e) {
        setError(errorText(t, e instanceof CircleClientError ? e.code : null, (e as Error).message));
        return;
      }
      if (!session) return; // Google mode: redirected
      setHasSession(true);
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
        const e = (j as { error?: { code?: string; message?: string } }).error;
        if (e?.code === "UNAUTHORIZED") logout();
        throw new CircleClientError(e?.code ?? "TX_FAILED", e?.message ?? "");
      }
      await refresh();
    } catch (err) {
      setError(errorText(t, err instanceof CircleClientError ? err.code : "TX_FAILED", (err as Error).message));
    } finally {
      setBusyStop(null);
    }
  };

  const canUse = (s: StopView) => it.status === "PAID" && s.status === "PENDING" && !!vouchers[s.id];
  const next = it.stops.find(canUse) ?? null;
  // Paid stops whose code isn't on this device (paid in another browser, or data cleared).
  const missing = it.status === "PAID" ? it.stops.filter((s) => s.status === "PENDING" && !vouchers[s.id]) : [];
  const paidStops = it.stops.filter((s) => s.status !== "FREE");
  const paidOut = paidStops.filter((s) => s.status === "RELEASED").reduce((n, s) => n + Number(s.priceUsdc), 0);
  const refunded = paidStops.filter((s) => s.status === "REFUNDED").reduce((n, s) => n + Number(s.priceUsdc), 0);
  const txs = [
    it.depositTxHash ? { label: t.txDeposit, hash: it.depositTxHash } : null,
    ...it.stops.flatMap((s) => [
      s.releaseTx ? { label: `${t.txRelease} · ${s.name}`, hash: s.releaseTx } : null,
      s.refundTx ? { label: `${t.txRefund} · ${s.name}`, hash: s.refundTx } : null,
    ]),
  ].filter((x): x is { label: string; hash: string } => !!x);

  const cancelButton = (s: StopView) => (
    <button
      type="button"
      disabled={busyStop !== null}
      onClick={() => void cancel(s)}
      className="min-h-11 w-full rounded-xl border border-danger/40 px-3 text-sm font-medium text-danger disabled:opacity-50"
    >
      {busyStop === s.id ? t.loading : hasSession ? `${t.cantMakeIt} ${t.cancelStop}` : authMode() === "pin" ? t.connectToCancel : t.cancelLogin}
    </button>
  );

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {missing.length > 0 && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">{t.codesMissing}</p>
      )}

      {/* 1. What to do now */}
      {next && (
        <section className="rounded-[24px] bg-gradient-to-br from-[#0f3a32] via-[#0b2a24] to-[#081d19] p-5">
          <div className="text-[11px] font-extrabold tracking-[2px] text-accent">{t.nextStop}</div>
          <h2 className="mt-2 font-display text-xl leading-snug font-extrabold text-white">
            {CATEGORY_EMOJI[next.category] ?? "📍"} {next.name}
          </h2>
          <p className="mt-1 text-sm text-[#b8cdc6]">
            {hhmm(next.arriveAt)} · {usdc(next.priceUsdc)}
          </p>
          <div className="mt-4 flex justify-center">
            <QRVoucher payload={vouchers[next.id]} label={next.name} />
          </div>
          <div className="mt-3">{cancelButton(next)}</div>
        </section>
      )}

      {/* Finished trip: the outcome in one glance */}
      {it.status !== "PAID" && paidStops.length > 0 && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-[20px] border border-line bg-surface p-4">
            <div className="text-xs text-ink-2">{t.dashPaidOut}</div>
            <b className="mt-1 block text-lg text-white">{usdc(paidOut)}</b>
          </div>
          <div className="rounded-[20px] border border-line bg-surface p-4">
            <div className="text-xs text-ink-2">{t.dashReturned}</div>
            <b className="mt-1 block text-lg text-white">{usdc(refunded)}</b>
          </div>
        </section>
      )}

      {/* 2. Every stop and its state */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-ink-2">{t.tripStops}</h2>
        <ol className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
          {it.stops.map((s) => {
            const st = stopState(s, t);
            const isNext = next?.id === s.id;
            const showQr = openQr === s.id && canUse(s) && !isNext;
            return (
              <li key={s.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${st.cls}`} aria-hidden>
                    {st.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 font-semibold text-white">
                        {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
                      </h3>
                      <PriceLabel price={s.priceUsdc} source={s.priceSource} />
                    </div>
                    <p className="text-xs text-ink-2">
                      {hhmm(s.arriveAt)} · {s.durationMin} {t.minutes}
                      {s.merchant && Number(s.priceUsdc) > 0 ? ` · ${merchantName(t, s.merchant)}` : ""}
                    </p>
                    <p className={`mt-1 text-xs font-semibold ${s.status === "PENDING" ? "text-accent" : "text-ink-2"}`}>
                      {isNext ? `${st.label} · ${t.nextStopShort}` : s.status === "FREE" ? t.noVoucherFree : st.label}
                    </p>
                    {it.status === "PAID" && s.status === "PENDING" && !vouchers[s.id] && <div className="mt-2">{cancelButton(s)}</div>}
                    {canUse(s) && !isNext && (
                      <button
                        type="button"
                        onClick={() => setOpenQr(showQr ? null : s.id)}
                        aria-expanded={showQr}
                        className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-surface-2 px-3 text-sm font-semibold text-accent"
                      >
                        {showQr ? t.hideQr : t.showQr}
                      </button>
                    )}
                  </div>
                </div>
                {showQr && (
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-center">
                      <QRVoucher payload={vouchers[s.id]} label={s.name} />
                    </div>
                    {cancelButton(s)}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* 3. Blockchain record, out of the way */}
      {txs.length > 0 && (
        <details className="group rounded-[20px] border border-line bg-surface px-4 open:pb-4">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-2">
            {t.txSection} ({txs.length})
            <span className="transition-transform group-open:rotate-180" aria-hidden>
              ⌄
            </span>
          </summary>
          <ul className="space-y-1">
            {txs.map((x) => (
              <li key={x.hash}>
                {explorerUrl ? (
                  <a
                    href={`${explorerUrl}/tx/${x.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-10 items-center justify-between gap-3 text-sm text-ink hover:text-accent"
                  >
                    <span className="min-w-0 truncate">{x.label}</span>
                    <span className="shrink-0 text-xs text-accent tabular-nums">
                      {x.hash.slice(0, 8)}…{x.hash.slice(-4)} ↗
                    </span>
                  </a>
                ) : (
                  <div className="flex min-h-10 items-center justify-between gap-3 text-sm text-ink">
                    <span className="min-w-0 truncate">{x.label}</span>
                    <span className="shrink-0 text-xs text-ink-2 tabular-nums">
                      {x.hash.slice(0, 8)}…{x.hash.slice(-4)}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
