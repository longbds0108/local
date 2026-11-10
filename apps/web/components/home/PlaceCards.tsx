"use client";

import { distance } from "@/lib/format";
import type { MapPlace } from "@/lib/types";
import { useI18n } from "../I18nProvider";

const IMG = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`;
// Category photos (illustrative, not of the specific place).
const CATEGORY_IMG: Record<string, string> = {
  restaurant: IMG("photo-1559314809-0d155014e29e"),
  beach: IMG("photo-1507525428034-b723cf961d3e"),
  viewpoint: IMG("photo-1464822759023-fed622ff2c3b"),
  attraction: IMG("photo-1464822759023-fed622ff2c3b"),
  cafe: IMG("photo-1495474472287-4d71bcdd2085"),
  museum: IMG("photo-1518998053901-5348d3961a04"),
};

type Props = {
  places: MapPlace[];
  saved: Set<string>;
  onToggleSave: (osmId: string) => void;
  onAdd: (p: MapPlace) => void;
  busy: boolean;
};

export default function PlaceCards({ places, saved, onToggleSave, onAdd, busy }: Props) {
  const { t, locale } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
      {places.map((p) => {
        const free = p.priceUsdc === 0;
        const tag = p.merchantId && !free ? { text: t.tagUsdc, cls: "bg-[#d9fbed] text-[#087454]" } : free ? { text: t.tagFree, cls: "bg-[#fff0c9] text-[#7d5912]" } : { text: (t.category[p.category] ?? p.category).toUpperCase(), cls: "bg-white text-[#122c26]" };
        const isSaved = saved.has(p.osmId);
        const name = locale === "en" && p.nameEn ? p.nameEn : p.name;
        return (
          <article
            key={p.osmId}
            className="overflow-hidden rounded-[17px] border border-[#dfe5df] bg-white text-cream-ink transition duration-200 hover:-translate-y-1 hover:shadow-[0_15px_40px_#52645e20]"
          >
            <div
              className="relative h-[210px] bg-cover bg-center sm:h-[165px]"
              style={{ backgroundImage: `url('${CATEGORY_IMG[p.category] ?? CATEGORY_IMG.attraction}')` }}
            >
              <span className={`absolute top-3 left-3 rounded-[7px] px-2 py-1.5 text-[9px] font-extrabold tracking-[0.8px] ${tag.cls}`}>{tag.text}</span>
              <button
                type="button"
                onClick={() => onToggleSave(p.osmId)}
                className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-white text-lg text-[#e4572e]"
                aria-pressed={isSaved}
                aria-label={isSaved ? t.unsave : t.save}
              >
                {isSaved ? "♥" : "♡"}
              </button>
            </div>
            <div className="grid grid-cols-[1fr_auto] p-4">
              <div className="min-w-0">
                <h3 className="mb-1 truncate font-display text-[15px] font-bold">{name}</h3>
                <p className="text-[11px] text-[#84918d]">
                  {t.category[p.category] ?? p.category} · {distance(p.distanceM)}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-[#84918d]">{p.source === "seed" ? t.curated : "OSM"}</span>
              <div className="col-span-full mt-4 mb-3 flex items-center justify-between gap-2 text-[11px]">
                <span className={p.openNow === false ? "text-[#b5452b]" : "text-[#1a926f]"}>
                  {p.openNow === true ? t.openNow : p.openNow === false ? t.closedNow : t.unknownHours}
                </span>
                <strong className="text-right">
                  {free ? t.free : `~${p.priceUsdc} USDC${t.perPerson}`}
                  {!free && <span className="block text-[9px] font-normal text-[#84918d]">{p.priceSource === "estimate" ? t.estimate : t.demoPrice}</span>}
                </strong>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(p)}
                className="col-span-full min-h-[40px] rounded-[9px] bg-[#e5f8f1] p-2.5 text-sm font-bold text-[#08795a] hover:bg-[#d4f3e7] disabled:opacity-50"
              >
                {t.addToPlan}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
