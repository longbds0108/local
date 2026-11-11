"use client";

import { CATEGORY_EMOJI, distance } from "@/lib/format";
import type { MapPlace } from "@/lib/types";
import { useI18n } from "../I18nProvider";

const IMG = (id: string, w: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=75`;
// Category photos (illustrative, not of the specific place).
const CATEGORY_IMG_ID: Record<string, string | undefined> = {
  restaurant: "photo-1559314809-0d155014e29e",
  beach: "photo-1507525428034-b723cf961d3e",
  viewpoint: "photo-1464822759023-fed622ff2c3b",
  // attraction: no generic photo fits parks, temples, monuments… → icon tile
  cafe: "photo-1495474472287-4d71bcdd2085",
  museum: "photo-1518998053901-5348d3961a04",
};

type Props = {
  places: MapPlace[];
  saved: Set<string>;
  onToggleSave: (osmId: string) => void;
  onAdd: (p: MapPlace) => void;
  busy: boolean;
};

/**
 * Mobile: compact horizontal rows (thumbnail left) so several places fit on a
 * screen. ≥640px: photo cards in a grid.
 */
export default function PlaceCards({ places, saved, onToggleSave, onAdd, busy }: Props) {
  const { t, locale } = useI18n();
  return (
    <div className="fx-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px] lg:grid-cols-3">
      {places.map((p) => {
        const free = p.priceUsdc === 0;
        const tag =
          p.merchantId && !free
            ? { text: t.tagUsdc, cls: "bg-[#d9fbed] text-[#087454]" }
            : free
              ? { text: t.tagFree, cls: "bg-[#fff0c9] text-[#7d5912]" }
              : { text: (t.category[p.category] ?? p.category).toUpperCase(), cls: "bg-white text-[#122c26]" };
        const isSaved = saved.has(p.osmId);
        const name = locale === "en" && p.nameEn ? p.nameEn : p.name;
        const imgId = CATEGORY_IMG_ID[p.category];
        const heart = (cls: string) => (
          <button
            type="button"
            onClick={() => onToggleSave(p.osmId)}
            className={`grid place-items-center rounded-full text-xl text-[#e4572e] ${cls}`}
            aria-pressed={isSaved}
            aria-label={isSaved ? t.unsave : t.save}
          >
            {isSaved ? "♥" : "♡"}
          </button>
        );
        return (
          <article
            key={p.osmId}
            className="fx-card flex overflow-hidden rounded-2xl border border-[#dfe5df] bg-white text-cream-ink transition duration-200 sm:block sm:rounded-[17px] sm:hover:-translate-y-1 sm:hover:shadow-[0_15px_40px_#52645e20]"
          >
            <div className="relative w-[104px] shrink-0 overflow-hidden sm:h-[165px] sm:w-full">
            <div
              className="fx-zoom absolute inset-0 bg-cover bg-center"
              style={
                imgId
                  ? { backgroundImage: `url('${IMG(imgId, 700)}')` }
                  : { background: "radial-gradient(circle at 30% 20%, #86ffd2 0%, #25b78a 45%, #0c3028 100%)" }
              }
            />
            <div className="relative grid h-full place-items-center">
              {!imgId && (
                <span className="text-4xl drop-shadow sm:text-6xl" aria-hidden>
                  {CATEGORY_EMOJI[p.category] ?? "📍"}
                </span>
              )}
              <span className={`absolute top-3 left-3 hidden rounded-[7px] px-2 py-1.5 text-[11px] font-extrabold tracking-[0.6px] sm:inline-block ${tag.cls}`}>
                {tag.text}
              </span>
              {heart("absolute top-3 right-3 hidden h-10 w-10 bg-white sm:grid")}
            </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 font-display text-[15px] leading-snug font-bold sm:truncate">{name}</h3>
                {p.source === "seed" && <span className="hidden shrink-0 text-[11px] font-semibold text-[#84918d] sm:inline">{t.curated}</span>}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[#6f7d79]">
                <span>
                  {t.category[p.category] ?? p.category} · {distance(p.distanceM)}
                </span>
                {(p.merchantId && !free) || free ? (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold sm:hidden ${tag.cls}`}>{tag.text}</span>
                ) : null}
              </p>
              <div className="mt-2 flex items-end justify-between gap-2 text-xs sm:mt-4 sm:mb-3">
                <span className={p.openNow === false ? "text-[#b5452b]" : "text-[#1a926f]"}>
                  {p.openNow === true ? t.openNow : p.openNow === false ? t.closedNow : (
                    <>
                      <span className="sm:hidden">{t.unknownHoursShort}</span>
                      <span className="hidden sm:inline">{t.unknownHours}</span>
                    </>
                  )}
                </span>
                <strong className="text-right whitespace-nowrap">
                  {free ? t.free : `~${p.priceUsdc} USDC${t.perPerson}`}
                  {!free && (
                    <span className="block text-[11px] font-normal text-[#84918d]">{p.priceSource === "estimate" ? t.estimate : t.demoPrice}</span>
                  )}
                </strong>
              </div>
              <div className="mt-2 flex items-center gap-2 sm:mt-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAdd(p)}
                  className="fx-press min-h-11 flex-1 rounded-[10px] bg-[#e5f8f1] px-3 text-sm font-bold text-[#08795a] hover:bg-[#d4f3e7] disabled:opacity-50"
                >
                  <span className="sm:hidden">{t.addShort}</span>
                  <span className="hidden sm:inline">{t.addToPlan}</span>
                </button>
                {heart("h-11 w-11 shrink-0 border border-[#dfe5df] bg-white sm:hidden")}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
