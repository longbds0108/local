"use client";

import { useRef, useState } from "react";
import { errorText } from "@/lib/error-text";
import { usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import type { ItineraryView, StopView } from "@/lib/types";
import { parseVenue } from "@/lib/venue-qr";
import type { Hex } from "viem";
import { useI18n } from "../I18nProvider";
import Scanner from "../Scanner";

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "confirm"; stop: StopView; merchantId: string }
  | { kind: "paying"; stop: StopView }
  | { kind: "done"; stop: StopView; url: string | null }
  | { kind: "error"; message: string };

/**
 * Pay at the venue by scanning ITS QR (like any Vietnamese QR payment). The
 * venue QR only names the venue; this device then submits the stop's check-in
 * code, which only it holds. The escrow can only pay the venue fixed at booking.
 */
export default function PayByScan({ it, codes, onPaid }: { it: ItineraryView; codes: Record<string, Hex>; onPaid: () => void }) {
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
    // Earliest stop at this venue that is still waiting and whose code is on this device.
    const stop = it.stops
      .filter((s) => s.status === "PENDING" && s.merchant?.id === merchantId && codes[s.id])
      .sort((a, b) => (a.arriveAt < b.arriveAt ? -1 : 1))[0];
    if (!stop) return setState({ kind: "error", message: t.venueNotInTrip });
    setState({ kind: "confirm", stop, merchantId });
  };

  const pay = async (stop: StopView, merchantId: string) => {
    setState({ kind: "paying", stop });
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopId: stop.id, code: codes[stop.id].slice(2), merchantId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = (j as { error?: { code?: string; message?: string } }).error;
        return setState({ kind: "error", message: errorText(t, e?.code, e?.message) });
      }
      setState({ kind: "done", stop, url: (j as { explorerTxUrl?: string | null }).explorerTxUrl ?? null });
      onPaid();
    } catch {
      setState({ kind: "error", message: t.err.NETWORK });
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
          }} className="min-h-10 w-full text-sm font-semibold text-ink-2">
          {t.cancelAction}
        </button>
      </div>
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
            onClick={() => state.kind === "confirm" && void pay(s, state.merchantId)}
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
          ✅ {t.paidToVenue.replace("{amount}", usdc(state.stop.priceUsdc)).replace("{venue}", venue(state.stop))}
          {state.url && (
            <a href={state.url} target="_blank" rel="noreferrer" className="ml-1 underline">
              ↗
            </a>
          )}
        </p>
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
