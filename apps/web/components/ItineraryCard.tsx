"use client";

import Link from "next/link";
import { CATEGORY_EMOJI, hhmm, tripDay, usdc } from "@/lib/format";
import type { ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "./I18nProvider";
import { paySplit } from "@/lib/pay-modes";
import { payModeLabel } from "@/lib/stop-info";

/**
 * A stop's price. Pay-at-venue and pay-yourself stops are estimates ("~"); once a
 * pay-at-venue stop is paid, the amount actually paid is shown instead.
 */
export function PriceLabel({ stop }: { stop: Pick<StopView, "priceUsdc" | "priceSource" | "payMode" | "paidUsdc" | "status"> }) {
  const { t } = useI18n();
  if (Number(stop.priceUsdc) === 0) return <span className="text-ok text-xs font-medium">{t.free}</span>;
  if (stop.payMode === "VENUE" && stop.status === "RELEASED" && stop.paidUsdc) {
    return (
      <span className="whitespace-nowrap text-xs font-semibold text-ink">
        {usdc(stop.paidUsdc)} <span className="font-normal text-ink-2">({t.paidLabel})</span>
      </span>
    );
  }
  const approx = stop.payMode === "VENUE" || stop.payMode === "SELF";
  return (
    <span className="whitespace-nowrap text-xs font-semibold text-ink">
      {approx ? "~" : ""}
      {usdc(stop.priceUsdc)}{" "}
      <span className="font-normal text-ink-2">({approx || stop.priceSource === "estimate" ? t.estimate : t.demoPrice})</span>
    </span>
  );
}

export default function ItineraryCard({ itinerary, compact = false }: { itinerary: ItineraryView; compact?: boolean }) {
  const { t } = useI18n();
  const paid = itinerary.status !== "DRAFT";
  const split = paySplit(itinerary.stops);
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-ink">{itinerary.title}</h3>
          <p className="text-xs text-ink-2">
            {tripDay(itinerary.startAt, t.dayTomorrow) && `${tripDay(itinerary.startAt, t.dayTomorrow)} · `}{hhmm(itinerary.startAt)}–{hhmm(itinerary.endAt)} · {itinerary.partySize} {itinerary.partySize === 1 ? t.person : t.people} · {itinerary.stops.length} {t.stops}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
          {t.status[itinerary.status]}
        </span>
      </div>

      {!compact && (
        <ol className="mt-3 space-y-2">
          {itinerary.stops.map((s, i) => (
            <li key={s.id} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {CATEGORY_EMOJI[s.category] ?? "📍"} {s.name}
                  </span>
                  <PriceLabel stop={s} />
                </div>
                <p className="text-xs text-ink-2">
                  {hhmm(s.arriveAt)} · {s.durationMin} {t.minutes}
                  {payModeLabel(t, s) && <> · {payModeLabel(t, s)}</>}
                  {s.travelMin > 0 && (
                    <>
                      {" "}
                      · 🛵 {s.travelMin} {t.minutes} {t.travel}
                    </>
                  )}
                </p>
                {s.note && <p className="mt-0.5 text-xs italic text-ink-2">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-ink-2">{split.prepay > 0 ? t.splitPrepay : t.totalEstimate}</div>
          <div className="text-base font-bold text-ink">{usdc(split.prepay > 0 ? split.prepay.toFixed(2) : itinerary.totalUsdc)}</div>
          {split.prepay > 0 && split.prepay < Number(itinerary.totalUsdc) && (
            <div className="text-[11px] text-ink-2">
              {t.totalEstimate}: {usdc(itinerary.totalUsdc)}
            </div>
          )}
        </div>
        <Link
          href={`/trips/${itinerary.id}`}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90"
        >
          {paid ? t.viewVouchers : t.viewPayment}
        </Link>
      </div>
    </div>
  );
}
