"use client";

import { useMemo } from "react";
import { hhmm } from "@/lib/format";
import { sunset } from "@/lib/sun";
import { useI18n } from "../I18nProvider";

export type GpsState = "locating" | "ok" | "denied" | "far";

const HERO_IMG =
  "https://images.unsplash.com/photo-1570366583862-f91883984fde?auto=format&fit=crop&w=1200&q=85";

export default function Hero({ gps, onUpdateLocation }: { gps: GpsState; onUpdateLocation: () => void }) {
  const { t } = useI18n();

  // Real sunset time for Vũng Tàu today (computed, not a forecast).
  const sun = useMemo(() => {
    const now = new Date();
    const s = sunset(now, 10.346, 107.0843);
    if (!s) return null;
    const min = Math.round((s.getTime() - now.getTime()) / 60_000);
    return { time: hhmm(s), min };
  }, []);

  const locLabel =
    gps === "ok" ? t.heroLocGps : gps === "locating" ? t.gpsLocating : gps === "far" ? t.heroLocFar : t.heroLocDefault;

  return (
    <section className="mx-auto grid max-w-[1440px] items-center gap-10 px-5 pt-10 pb-14 md:min-h-[600px] md:grid-cols-[1.05fr_.95fr] md:gap-[7vw] md:px-[7vw] md:pt-[78px] md:pb-[62px]">
      <div>
        <div className="text-[11px] font-extrabold tracking-[2px] text-accent">✦ {t.heroEyebrow}</div>
        <h1 className="my-6 font-display text-[43px] leading-[0.98] font-extrabold text-white md:text-[clamp(48px,6vw,82px)]">
          {t.heroTitle1}
          <br />
          <em className="text-accent not-italic">{t.heroTitle2}</em>
        </h1>
        <p className="max-w-[590px] text-base leading-[1.7] text-[#a7bbb5] md:text-lg">{t.heroBody}</p>
        <div className="mt-8 flex max-w-[410px] items-center gap-3.5 rounded-[15px] border border-[#25423d] bg-[#0b211e] px-3.5 py-3">
          <span className="text-2xl text-accent" aria-hidden>
            ◎
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <small className="text-[10px] text-ink-2">{t.heroYourLocation}</small>
            <strong className="truncate text-sm">{locLabel}</strong>
          </div>
          <button type="button" onClick={onUpdateLocation} className="text-sm font-bold text-accent hover:underline">
            {t.heroUpdate}
          </button>
        </div>
      </div>

      <div className="relative">
        <div
          className="relative h-[330px] overflow-hidden rounded-[36px] border border-white/10 shadow-[0_30px_90px_#0008] md:h-[430px]"
          style={{
            background: `linear-gradient(0deg, rgba(4,28,24,.8), transparent 60%), url('${HERO_IMG}') center/cover`,
          }}
          role="img"
          aria-label={t.heroImgAlt}
        >
          <div className="absolute top-5 right-5 flex flex-col rounded-[14px] bg-[#061513bd] px-3.5 py-3 backdrop-blur-md">
            <b className="text-sm">Arc Testnet</b>
            <span className="text-[10px] text-[#b8cbc4]">{t.heroChipUsdc}</span>
          </div>
        </div>
        {sun && (
          <div className="absolute right-2.5 bottom-7 left-2.5 flex items-center gap-3 rounded-2xl bg-[#f0f4ed] p-4 text-[#10211e] shadow-[0_18px_45px_#0008] md:right-auto md:-left-10">
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-[#d7fbed] text-[#08795a]">✦</span>
            <div className="flex flex-col">
              <b>{sun.min > 0 ? t.heroSunsetSoon : t.heroSunsetToday}</b>
              <small className="text-[#60736d]">
                {sun.min > 0 && sun.min < 180
                  ? t.heroSunsetIn.replace("{min}", String(sun.min)).replace("{time}", sun.time)
                  : t.heroSunsetAt.replace("{time}", sun.time)}
              </small>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
