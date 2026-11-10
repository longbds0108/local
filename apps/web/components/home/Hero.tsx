"use client";

import { useEffect, useMemo, useState } from "react";
import { hhmm } from "@/lib/format";
import { sunset } from "@/lib/sun";
import { describeWeather, weatherTip } from "@/lib/weather-codes";
import { useI18n } from "../I18nProvider";

export type GpsState = "locating" | "ok" | "denied" | "far";

export type HereInfo = { lat: number; lon: number; label: string | null; kmToCity: number } | null;

export type LocationInfo = {
  label: string | null;
  weather: { tempC: number; feelsC: number; humidity: number; code: number; isDay: boolean; sunset: string | null } | null;
  dishes?: string[];
  landmark: {
    nameVi: string;
    nameEn: string;
    image: string;
    filePage: string;
    artist: string | null;
    license: string;
    licenseUrl: string | null;
  } | null;
};

/** Shown until (or when no) landmark photo is available for the location. */
const DEFAULT_IMG = "https://images.unsplash.com/photo-1570366583862-f91883984fde?auto=format&fit=crop&w=1200&q=85";

type Props = {
  gps: GpsState;
  here: HereInfo;
  info: LocationInfo | null;
  infoLoading: boolean;
  onUpdateLocation: () => void;
};

export default function Hero({ gps, here, info, infoLoading, onUpdateLocation }: Props) {
  const { t, locale } = useI18n();

  // Preload the landmark photo so the swap doesn't flash an empty frame.
  const target = info?.landmark?.image ?? null;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      if (info) setShown(DEFAULT_IMG);
      return;
    }
    const img = new Image();
    img.onload = () => setShown(target);
    img.onerror = () => setShown(DEFAULT_IMG);
    img.src = target;
  }, [target, info]);

  // Sunset: from the weather service (local time at that place), else computed for Vũng Tàu.
  const sun = useMemo(() => {
    if (info?.weather?.sunset) return { time: info.weather.sunset, place: info.label?.split(",")[0] ?? null };
    const s = sunset(new Date(), 10.346, 107.0843);
    return s ? { time: hhmm(s), place: locale === "vi" ? "Vũng Tàu" : "Vung Tau" } : null;
  }, [info, locale]);

  const where =
    gps === "locating"
      ? t.gpsLocating
      : gps === "denied"
        ? t.heroLocNoGps
        : here?.label ?? info?.label ?? (here ? `${here.lat.toFixed(4)}, ${here.lon.toFixed(4)}` : t.gpsLocating);
  const status = gps === "ok" ? t.heroInDemo : gps === "denied" ? t.heroLocDefault : null;

  const w = info?.weather;
  const wd = w ? describeWeather(w.code, w.isDay, locale) : null;
  const lm = info?.landmark;

  return (
    <section className="mx-auto grid max-w-[1440px] items-center gap-7 px-[18px] pt-7 pb-10 md:min-h-[600px] md:grid-cols-[1.05fr_.95fr] md:gap-[7vw] md:px-[7vw] md:pt-[78px] md:pb-[62px]">
      <div>
        <div className="text-[11px] font-extrabold tracking-[2px] text-accent">✦ {t.heroEyebrow}</div>
        <h1 className="my-4 font-display text-[34px] leading-[1.02] md:my-6 md:leading-[0.98] font-extrabold text-white md:text-[clamp(48px,6vw,82px)]">
          {t.heroTitle1}
          <br />
          <em className="text-accent not-italic">{t.heroTitle2}</em>
        </h1>
        <p className="max-w-[590px] text-[15px] leading-relaxed text-[#a7bbb5] md:text-lg md:leading-[1.7]">{t.heroBody}</p>
        <div className="mt-6 flex max-w-[460px] items-center gap-3.5 md:mt-8 rounded-[15px] border border-[#25423d] bg-[#0b211e] px-3.5 py-3">
          <span
            className={`text-2xl ${gps === "ok" ? "text-accent" : gps === "locating" || infoLoading ? "animate-pulse text-ink-2" : "text-warn"}`}
            aria-hidden
          >
            ◎
          </span>
          <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
            <small className="text-[11px] text-ink-2">{t.heroYourLocation}</small>
            <strong className="text-sm leading-snug">{where}</strong>
            {status && <span className={`mt-0.5 text-[11px] leading-snug ${gps === "ok" ? "text-accent" : "text-warn"}`}>{status}</span>}
          </div>
          <button
            type="button"
            onClick={onUpdateLocation}
            disabled={gps === "locating" || infoLoading}
            className="-my-2 min-h-11 min-w-11 shrink-0 px-1 text-sm font-bold text-accent hover:underline disabled:opacity-50"
          >
            {gps === "locating" || infoLoading ? "…" : t.heroUpdate}
          </button>
        </div>
      </div>

      <div className="relative">
        <div className="relative h-[260px] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b211e] shadow-[0_30px_90px_#0008] md:h-[430px] md:rounded-[36px]">
          {shown && (
            // Background layer swaps with a fade when the location changes.
            <div
              key={shown}
              className="absolute inset-0 animate-[fadein_.6s_ease]"
              style={{ background: `linear-gradient(0deg, rgba(4,28,24,.8), transparent 60%), url('${shown}') center/cover` }}
              role="img"
              aria-label={lm && shown === lm.image ? (locale === "vi" ? lm.nameVi : lm.nameEn) : t.heroImgAlt}
            />
          )}
          {!shown && <div className="absolute inset-0 animate-pulse bg-[#12312b]" />}

          {/* Landmark name + required photo credit (Wikimedia Commons license). */}
          {lm && shown === lm.image && (
            <div className="absolute top-3 left-3 max-w-[52%] rounded-[14px] bg-[#061513bd] px-3 py-2 backdrop-blur-md md:top-5 md:left-5 md:max-w-[60%] md:px-3.5 md:py-2.5">
              <b className="block text-sm leading-tight">📍 {locale === "vi" ? lm.nameVi : lm.nameEn}</b>
              <a
                href={lm.filePage}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block min-h-6 truncate pt-1 text-[11px] text-[#b8cbc4] hover:underline"
                title={`${lm.artist ?? ""} · ${lm.license} · Wikimedia Commons`}
              >
                {t.photoBy} {lm.artist ?? "Wikimedia Commons"} · {lm.license}
              </a>
            </div>
          )}

          {/* Current weather at the user's (or demo) location. */}
          <div className="absolute top-3 right-3 flex max-w-[46%] flex-col rounded-[14px] bg-[#061513bd] px-3 py-2 text-right backdrop-blur-md md:top-5 md:right-5 md:max-w-none md:px-3.5 md:py-3" aria-live="polite">
            {w && wd ? (
              <>
                <b className="text-xl leading-none">
                  {wd.icon} {w.tempC}°
                </b>
                <span className="mt-1 text-[11px] text-[#b8cbc4]">
                  {wd.label}
                  <span className="hidden md:inline">
                    {" "}
                    · {t.feelsLike} {w.feelsC}°
                  </span>
                </span>
                <span className="hidden text-[11px] text-accent md:inline">{weatherTip(w.code, w.tempC, locale)}</span>
              </>
            ) : (
              <span className="text-[11px] text-[#b8cbc4]">{infoLoading ? t.weatherLoading : t.weatherUnavailable}</span>
            )}
          </div>
        </div>

        {sun && (
          <div className="absolute right-3 bottom-3 left-3 flex items-center gap-3 rounded-2xl bg-[#f0f4ed] p-3 text-[#10211e] shadow-[0_18px_45px_#0008] md:right-auto md:bottom-7 md:-left-10 md:p-4">
            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-[#d7fbed] text-[#08795a]">✦</span>
            <div className="flex flex-col">
              <b>{t.heroSunsetToday}</b>
              <small className="text-[#60736d]">
                {t.heroSunsetAt.replace("{time}", sun.time).replace("{place}", sun.place ?? "")}
              </small>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
