"use client";

import { useEffect, useRef, useState } from "react";
import { CircleClientError, connectWallet, ensureWallet, executeChallenge, getOrRefreshSession, logout } from "@/lib/circle-client";
import { errorText } from "@/lib/error-text";
import { usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { ItineraryView, StopView } from "@/lib/types";
import { parseVenue, venuePayload } from "@/lib/venue-qr";
import type { Hex } from "viem";
import { useI18n } from "../I18nProvider";
import Scanner from "../Scanner";

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  // Prepaid stop: the money is already held; confirming releases it.
  | { kind: "confirm"; stop: StopView; merchantId: string }
  // Pay-at-venue stop: the traveller enters the bill, then confirms with the PIN.
  | { kind: "amount"; stop: StopView; merchantId: string; amount: string; invalid?: boolean }
  | { kind: "paying"; stop: StopView; text?: string }
  | { kind: "pending"; stop: StopView }
  | { kind: "done"; stop: StopView; amount: string; url: string | null }
  | { kind: "error"; message: string };

class PayError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } }).error;
    throw new PayError(e?.code ?? `HTTP_${res.status}`, e?.message);
  }
  return j as T;
}

type Confirmed = { paid: boolean; amountUsdc?: string | null; explorerTxUrl?: string | null };

/**
 * Pay at the venue by scanning ITS QR (like any Vietnamese QR payment).
 * - Prepaid stop: this device submits the stop's check-in code, which only it holds;
 *   the escrow can only pay the venue fixed at booking.
 * - Pay-at-venue stop: a USDC transfer from the traveller's wallet straight to the
 *   venue, confirmed with the PIN; the server then checks the transfer on-chain.
 */
export default function PayByScan({
  it,
  codes,
  onPaid,
  returnTo,
}: {
  it: ItineraryView;
  codes: Record<string, Hex>;
  onPaid: () => void;
  returnTo: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "idle" });
  // Only the first decode of a scanning session counts (late camera frames are ignored).
  const accepting = useRef(false);
  const startScan = () => {
    accepting.current = true;
    setState({ kind: "scanning" });
  };

  const onScan = (text: string) => {
    if (!accepting.current) return;
    accepting.current = false;
    const merchantId = parseVenue(text);
    if (!merchantId) return setState({ kind: "error", message: t.notVenueQr });
    // Earliest stop at this venue still waiting: prepaid (code on this device) or pay-at-venue.
    const stop = it.stops
      .filter((s) => s.status === "PENDING" && s.merchant?.id === merchantId && (s.payMode === "VENUE" || codes[s.id]))
      .sort((a, b) => (a.arriveAt < b.arriveAt ? -1 : 1))[0];
    if (!stop) return setState({ kind: "error", message: t.venueNotInTrip });
    if (stop.payMode === "VENUE") return setState({ kind: "amount", stop, merchantId, amount: Number(stop.priceUsdc).toString() });
    setState({ kind: "confirm", stop, merchantId });
  };

  // Opened from the wallet's scanner (/trips/<id>?venue=<merchantId>): handle that venue as if
  // it had just been scanned here, once this device's check-in codes have loaded.
  const pendingVenue = useRef<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const v = url.searchParams.get("venue");
    if (!v) return;
    pendingVenue.current = v;
    url.searchParams.delete("venue");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  useEffect(() => {
    const v = pendingVenue.current;
    if (!v) return;
    const run = () => {
      if (pendingVenue.current !== v) return;
      pendingVenue.current = null;
      accepting.current = true;
      onScan(venuePayload(v));
      document.getElementById("pay-by-scan")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const ready = it.stops.some((s) => s.status === "PENDING" && s.merchant?.id === v && (s.payMode === "VENUE" || codes[s.id]));
    if (ready) return run();
    const timer = setTimeout(run, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes, it]);

  const fail = (err: unknown) => {
    const code = err instanceof PayError || err instanceof CircleClientError ? err.code : "NETWORK";
    if (code === "UNAUTHORIZED") logout();
    setState({ kind: "error", message: code === "NETWORK" ? t.err.NETWORK : errorText(t, code, (err as Error).message) });
  };

  const releasePrepaid = async (stop: StopView, merchantId: string) => {
    setState({ kind: "paying", stop });
    try {
      const j = await post<{ explorerTxUrl?: string | null }>("/api/checkin", { stopId: stop.id, code: codes[stop.id].slice(2), merchantId });
      setState({ kind: "done", stop, amount: stop.priceUsdc, url: j.explorerTxUrl ?? null });
      onPaid();
    } catch (err) {
      fail(err);
    }
  };

  /** Ask the server to look for the transfer on-chain, a few times. */
  const waitForTransfer = async (stop: StopView, tries: number) => {
    for (let i = 0; i < tries; i++) {
      const r = await post<Confirmed>("/api/venue-pay/confirm", { stopId: stop.id });
      if (r.paid) {
        setState({ kind: "done", stop, amount: r.amountUsdc ?? stop.priceUsdc, url: r.explorerTxUrl ?? null });
        onPaid();
        return;
      }
      await sleep(2000);
    }
    setState({ kind: "pending", stop });
  };

  const payVenue = async (stop: StopView, merchantId: string, raw: string) => {
    const amount = raw.trim().replace(",", ".");
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) {
      return setState({ kind: "amount", stop, merchantId, amount: raw, invalid: true });
    }
    setState({ kind: "paying", stop });
    try {
      let session = await getOrRefreshSession().catch(() => null);
      if (!session) {
        session = await connectWallet(returnTo);
        if (!session) return; // Google mode: redirected to sign in
      }
      if (!session.walletAddress) session = await ensureWallet(session);
      const { challengeId } = await post<{ challengeId: string }>("/api/venue-pay/challenge", {
        userToken: session.userToken,
        stopId: stop.id,
        amount,
        merchantId,
      });
      await executeChallenge(session, challengeId);
      setState({ kind: "paying", stop, text: t.confirmingVenue });
      await waitForTransfer(stop, 45);
    } catch (err) {
      fail(err);
    }
  };

  const venue = (s: StopView) => merchantName(t, s.merchant) || s.name;

  if (state.kind === "scanning") {
    return (
      <div className="space-y-2 rounded-xl bg-bg/60 p-3">
        <p className="text-sm text-[#c5d8d1]">{t.scanVenueHint}</p>
        <Scanner onScan={onScan} autoStart once label={t.scanVenue} />
        <button
          type="button"
          onClick={() => {
            accepting.current = false;
            setState({ kind: "idle" });
          }}
          className="min-h-10 w-full text-sm font-semibold text-ink-2"
        >
          {t.cancelAction}
        </button>
      </div>
    );
  }

  if (state.kind === "amount" || (state.kind === "paying" && state.stop.payMode === "VENUE")) {
    const s = state.stop;
    const busy = state.kind === "paying";
    const amount = state.kind === "amount" ? state.amount : "";
    return (
      <form
        className="space-y-3 rounded-xl border border-accent/40 bg-bg/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (state.kind === "amount") void payVenue(s, state.merchantId, state.amount);
        }}
      >
        <h3 className="font-display text-lg font-extrabold text-white">{t.payVenueTitle.replace("{venue}", venue(s))}</h3>
        {state.kind === "amount" ? (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-ink-2">{t.billAmount}</span>
              <input
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setState({ ...state, amount: e.target.value, invalid: false })}
                aria-invalid={state.invalid || undefined}
                className="mt-1 min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-lg font-bold text-white tabular-nums focus:border-accent focus:outline-none"
              />
            </label>
            {state.invalid ? (
              <p role="alert" className="text-xs text-danger">
                {t.invalidAmount}
              </p>
            ) : (
              <p className="text-xs text-ink-2">{t.billHint.replace("{amount}", usdc(s.priceUsdc))}</p>
            )}
            <p className="text-xs text-ink-2">{t.payVenueBody}</p>
          </>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-accent">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {state.text ?? t.payingVenue}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setState({ kind: "idle" })}
            className="min-h-12 rounded-xl border border-line text-sm font-bold text-ink disabled:opacity-50"
          >
            {t.cancelAction}
          </button>
          <button type="submit" disabled={busy} className="min-h-12 rounded-xl bg-accent text-sm font-bold text-accent-ink disabled:opacity-60">
            {busy ? t.payingVenue : t.payAmount.replace("{amount}", usdc(Number(amount.replace(",", ".")) || 0))}
          </button>
        </div>
      </form>
    );
  }

  if (state.kind === "confirm" || state.kind === "paying") {
    const s = state.stop;
    return (
      <div className="space-y-3 rounded-xl border border-accent/40 bg-bg/60 p-4">
        <h3 className="font-display text-lg font-extrabold text-white">
          {t.payToVenue.replace("{amount}", usdc(s.priceUsdc)).replace("{venue}", venue(s))}
        </h3>
        <p className="text-xs text-ink-2">{t.payToVenueBody}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={state.kind === "paying"}
            onClick={() => setState({ kind: "idle" })}
            className="min-h-12 rounded-xl border border-line text-sm font-bold text-ink disabled:opacity-50"
          >
            {t.cancelAction}
          </button>
          <button
            type="button"
            disabled={state.kind === "paying"}
            onClick={() => state.kind === "confirm" && void releasePrepaid(s, state.merchantId)}
            className="min-h-12 rounded-xl bg-accent text-sm font-bold text-accent-ink disabled:opacity-60"
          >
            {state.kind === "paying" ? t.payingVenue : t.confirmPay}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {state.kind === "done" && (
        <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">
          ✅ {t.paidToVenue.replace("{amount}", usdc(state.amount)).replace("{venue}", venue(state.stop))}
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer" className="ml-1 underline">
              ↗
            </a>
          )}
        </p>
      )}
      {state.kind === "pending" && (
        <div role="status" className="space-y-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          <p>{t.venuePayPending}</p>
          <button
            type="button"
            onClick={() => {
              const stop = state.stop;
              setState({ kind: "paying", stop, text: t.confirmingVenue });
              void waitForTransfer(stop, 5).catch(fail);
            }}
            className="min-h-10 rounded-lg border border-warn/50 px-3 font-semibold"
          >
            {t.checkAgain}
          </button>
        </div>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      <button
        type="button"
        onClick={startScan}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-base font-bold text-accent-ink"
      >
        📷 {t.scanVenue}
      </button>
    </div>
  );
}
