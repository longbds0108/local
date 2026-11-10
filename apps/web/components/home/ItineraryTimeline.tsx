"use client";

import Link from "next/link";
import { Fragment } from "react";
import { hhmm, usdc } from "@/lib/format";
import type { ItineraryView } from "@/lib/types";
import { useI18n } from "../I18nProvider";

export default function ItineraryTimeline({ itinerary }: { itinerary: ItineraryView | null }) {
  const { t } = useI18n();
  const paid = itinerary && itinerary.status !== "DRAFT";

  return (
    <section id="itinerary" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-[50px] md:px-[7vw] md:pt-[70px] md:pb-[90px]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-extrabold tracking-[2px] text-accent">{t.smartItinerary}</span>
          <h2 className="mt-1 font-display text-[26px] font-extrabold text-white md:text-[30px]">
            {itinerary ? itinerary.title : t.itineraryEmptyTitle}
          </h2>
          {itinerary && (
            <p className="mt-1 text-xs text-ink-2">
              {hhmm(itinerary.startAt)}–{hhmm(itinerary.endAt)} · {itinerary.partySize} {t.people} · {t.status[itinerary.status]}
            </p>
          )}
        </div>
        {itinerary && (
          <div className="shrink-0 text-right text-xs text-[#8ca19a]">
            {t.total}
            <b className="block text-lg text-accent">{usdc(itinerary.totalUsdc)}</b>
          </div>
        )}
      </div>

      {!itinerary ? (
        <div className="rounded-[22px] border border-dashed border-[#2b4a43] bg-surface p-6 text-sm text-ink-2 md:p-8">
          <p>{t.itineraryEmptyBody}</p>
          <a href="#ask" className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink">
            {t.askButton} →
          </a>
        </div>
      ) : (
        <>
          <div className="rounded-[22px] border border-line bg-surface px-4 py-5 md:px-[30px]">
            {itinerary.stops.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && (
                  <div className="ml-[62px] flex h-9 items-center border-l border-dashed border-[#4e6c63] pl-4 text-[10px] text-[#6f8a82] md:ml-[81px]">
                    🛵 {s.travelMin} {t.minutes}
                  </div>
                )}
                <div className="grid grid-cols-[48px_14px_1fr] items-center gap-3.5 md:grid-cols-[60px_18px_1fr_auto]">
                  <time className="font-bold">{hhmm(s.arriveAt)}</time>
                  <i className="h-3 w-3 rounded-full bg-accent shadow-[0_0_0_5px_#70efc01c]" />
                  <div className="min-w-0">
                    <small className="text-[9px] tracking-[1px] text-accent uppercase">
                      {t.category[s.category] ?? s.category} · {s.durationMin} {t.minutes}
                    </small>
                    <h3 className="my-1 font-display text-[17px] font-bold">{s.name}</h3>
                    <p className="text-xs text-[#859d95]">
                      {s.note ?? (i === 0 ? t.fromStart.replace("{min}", String(s.travelMin)) : "")}
                      <span className="md:hidden">
                        {s.note ? " · " : ""}
                        {Number(s.priceUsdc) > 0 ? usdc(s.priceUsdc) : t.free}
                      </span>
                    </p>
                  </div>
                  <b className="hidden text-sm md:block">
                    {Number(s.priceUsdc) > 0 ? (
                      <>
                        {Number(s.priceUsdc).toFixed(2)}
                        <span className="block text-right text-[9px] font-normal text-ink-2">{s.priceSource === "estimate" ? t.estimate : t.demoPrice}</span>
                      </>
                    ) : (
                      <span className="text-accent">{t.free}</span>
                    )}
                  </b>
                </div>
              </Fragment>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href={paid ? `/itinerary/${itinerary.id}` : `/pay/${itinerary.id}`}
              className="rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-ink hover:opacity-90"
            >
              {paid ? t.viewVouchers : t.viewPayment} →
            </Link>
            <span className="text-xs text-ink-2">◇ {t.approveNote}</span>
          </div>
        </>
      )}
    </section>
  );
}
