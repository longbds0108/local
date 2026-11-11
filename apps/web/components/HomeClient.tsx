"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSession, SESSION_EVENT } from "@/lib/circle-client";
import { clientReverse } from "@/lib/client-geocode";
import type { ItineraryView, MapPlace } from "@/lib/types";
import { useChat } from "@/lib/use-chat";
import AskCard from "./home/AskCard";
import Hero, { type GpsState, type HereInfo, type LocationInfo } from "./home/Hero";
import ItineraryTimeline from "./home/ItineraryTimeline";
import PlaceCards from "./home/PlaceCards";
import { useI18n } from "./I18nProvider";
import { dishLabel } from "@/lib/dish-names";
import { fxDelay } from "@/lib/fx";

const MapView = dynamic(() => import("./Map"), { ssr: false });

const CENTER = { lat: 10.346, lon: 107.0843 };
const SAVED_KEY = "hedgora.saved";
const PAGE = 9;

type Tab = "discover" | "map" | "saved";

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function MiniWallet() {
  const { t } = useI18n();
  const [addr, setAddr] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const s = getSession();
      setAddr(s?.walletAddress ?? null);
      setBalance(null);
      if (!s?.walletAddress) return;
      fetch(`/api/balance?address=${s.walletAddress}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setBalance(Number(j.usdc).toFixed(2)))
        .catch(() => {});
    };
    read();
    window.addEventListener(SESSION_EVENT, read);
    return () => window.removeEventListener(SESSION_EVENT, read);
  }, []);
  return (
    <div className="mt-auto rounded-2xl bg-[#0c2621] p-4 text-white">
      <small className="text-[11px] tracking-[1px] text-[#84a59b]">{t.travelWallet}</small>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-xs">{t.usdcBalance}</span>
        <b className="text-[22px]">{addr ? (balance ?? "…") : "—"}</b>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#b9cbc5]">
        <i className="inline-block h-[7px] w-[7px] rounded-full bg-accent" /> {t.arcTestnet}
      </div>
      {!addr && <p className="mt-2 text-[11px] text-[#84a59b]">{t.walletHint}</p>}
    </div>
  );
}

export default function HomeClient() {
  const { t, locale } = useI18n();
  const [gps, setGps] = useState<GpsState>("locating");
  const [here, setHere] = useState<HereInfo>(null);
  const [info, setInfo] = useState<LocationInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Place name + current weather + landmark photo for a point.
  const infoSeq = useRef(0);
  const loadInfo = useCallback(async (pt: { lat: number; lon: number }, isGps: boolean) => {
    const seq = ++infoSeq.current;
    setInfoLoading(true);
    try {
      // Browser-side geocode first (BigDataCloud); the server falls back to Photon.
      const place = await clientReverse(pt.lat, pt.lon, locale);
      const qs = new URLSearchParams({ lat: String(pt.lat), lon: String(pt.lon) });
      if (place) {
        qs.set("label", place.label);
        qs.set("names", place.names.join("|"));
        if (place.country) qs.set("country", place.country);
      }
      const res = await fetch(`/api/location?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as LocationInfo;
      if (seq !== infoSeq.current) return; // a newer request (other language/place) wins
      setInfo(j);
      if (isGps && j.label) setHere((h) => (h ? { ...h, label: j.label } : h));
    } catch {
      if (seq === infoSeq.current) setInfo((prev) => prev ?? { label: null, weather: null, landmark: null, dishes: [] });
    } finally {
      if (seq === infoSeq.current) setInfoLoading(false);
    }
  }, [locale]);
  const [start, setStart] = useState<{ lat: number; lon: number; isGps: boolean } | null>(null);
  // Switching language re-fetches the place name in that language.
  const infoLocale = useRef(locale);
  useEffect(() => {
    if (infoLocale.current === locale) return;
    infoLocale.current = locale;
    if (start) void loadInfo(start, start.isGps);
  }, [locale, start, loadInfo]);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [placesState, setPlacesState] = useState<"loading" | "ok" | "error">("loading");
  const [degraded, setDegraded] = useState(false);
  const [itinerary, setItinerary] = useState<ItineraryView | null>(null);
  const [tab, setTab] = useState<Tab>("discover");
  const [limit, setLimit] = useState(PAGE);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  // Local dish filter ("Cơm tấm", "Phở"…): real OSM food places whose name matches.
  const [dish, setDish] = useState<string | null>(null);
  const [dishPlaces, setDishPlaces] = useState<MapPlace[]>([]);
  const [dishState, setDishState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  // [1] GPS with fallback to the Vũng Tàu center.
  const locate = useCallback(() => {
    setGps("locating");
    if (!("geolocation" in navigator)) {
      setGps("denied");
      setStart({ ...CENTER, isGps: false });
      void loadInfo(CENTER, false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const kmToCity = km(pt, CENTER);
        setHere({ ...pt, label: null, kmToCity });
        // Suggestions follow the user wherever they are (Vũng Tàu is only the no-GPS default).
        setGps("ok");
        setStart({ ...pt, isGps: true });
        // Readable "district, city" + weather + landmark for where the user really is.
        void loadInfo(pt, true);
      },
      () => {
        setGps("denied");
        setStart({ ...CENTER, isGps: false });
        void loadInfo(CENTER, false);
      },
      // maximumAge 0: "Cập nhật" must re-read the position, not reuse a cached one.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }, [loadInfo]);

  // Deep links from the mobile bottom bar: /#map, /#saved, /#explore.
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash;
      if (h === "#map" || h === "#saved") {
        setTab(h === "#map" ? "map" : "saved");
        // After the tab renders, bring the map itself (or the saved list) into view.
        setTimeout(() => {
          const el = document.getElementById(h === "#map" ? "map-view" : "explore");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      } else if (h === "#explore") setTab("discover");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    locate();
    try {
      setSaved(new Set(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as string[]));
    } catch {
      /* ignore */
    }
  }, [locate]);

  // [2] Real POIs around the starting point.
  const loadPlaces = useCallback(async (p: { lat: number; lon: number }) => {
    setPlacesState("loading");
    try {
      const res = await fetch(`/api/places?lat=${p.lat}&lon=${p.lon}&radius=4000`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { places: MapPlace[]; degraded?: boolean };
      setPlaces(j.places);
      setDegraded(!!j.degraded);
      setPlacesState("ok");
    } catch {
      setPlacesState("error");
    }
  }, []);

  useEffect(() => {
    if (start) void loadPlaces(start);
  }, [start, loadPlaces]);

  const onPlaces = useCallback((more: MapPlace[]) => {
    setPlaces((prev) => {
      const byId = new Map(prev.map((p) => [p.osmId, p]));
      for (const p of more) if (!byId.has(p.osmId)) byId.set(p.osmId, p);
      return [...byId.values()];
    });
  }, []);

  const onItinerary = useCallback((it: ItineraryView | null) => {
    setItinerary(it);
    if (it) setTab("map"); // show the route
  }, []);

  const chat = useChat({ start, area: info?.label ?? null, onItinerary, onPlaces });

  const toggleSave = (osmId: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(osmId)) next.delete(osmId);
      else next.add(osmId);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const addToPlan = (p: MapPlace) => {
    void chat.send(itinerary && itinerary.status === "DRAFT" ? t.promptAdd.replace("{name}", p.name) : t.promptPlanWith.replace("{name}", p.name));
    document.getElementById("ask")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Server order already mixes categories (food, cafés, sights…) nearest-first.
  const sorted = places;
  const visible =
    tab === "saved" ? sorted.filter((p) => saved.has(p.osmId)) : dish ? dishPlaces : sorted.slice(0, limit);

  const area = info?.label?.split(",")[0]?.trim() || (start?.isGps ? null : locale === "vi" ? "Vũng Tàu" : "Vung Tau");
  const dishes = info?.dishes ?? [];

  const pickDish = async (d: string) => {
    if (!start) return;
    if (dish === d) {
      setDish(null);
      return;
    }
    setDish(d);
    setTab("discover");
    setDishState("loading");
    setDishPlaces([]);
    try {
      const res = await fetch(`/api/places?lat=${start.lat}&lon=${start.lon}&radius=5000&q=${encodeURIComponent(d)}`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { places: MapPlace[]; degraded?: boolean };
      const found = j.places;
      setDishPlaces(found);
      if (j.degraded) setDegraded(true);
      onPlaces(found); // also show them on the map
      setDishState("ok");
    } catch {
      setDishState("error");
    }
  };

  // A new location invalidates the dish filter.
  useEffect(() => {
    setDish(null);
    setDishPlaces([]);
  }, [start]);

  const tabs: { id: Tab | "itinerary"; icon: string; label: string }[] = [
    { id: "discover", icon: "⌂", label: t.tabDiscover },
    { id: "map", icon: "⌖", label: t.tabMap },
    { id: "itinerary", icon: "◇", label: t.tabItinerary },
    { id: "saved", icon: "▣", label: `${t.tabSaved}${saved.size ? ` (${saved.size})` : ""}` },
  ];
  const pick = (id: Tab | "itinerary") => {
    if (id === "itinerary") document.getElementById("itinerary")?.scrollIntoView({ behavior: "smooth" });
    else setTab(id);
  };

  return (
    <div className="relative overflow-x-clip">
      <div className="glow -top-[260px] -right-[100px] bg-[#28d7a4]" aria-hidden />
      <div className="glow top-[900px] -left-[200px] bg-[#2ca9ff]" aria-hidden />

      <Hero gps={gps} here={here} info={info} infoLoading={infoLoading} onUpdateLocation={locate} />

      <section
        id="explore"
        style={fxDelay(4)}
        className="fx-rise mx-auto grid min-h-[700px] max-w-[1440px] scroll-mt-20 rounded-t-[24px] bg-cream text-cream-ink md:grid-cols-[210px_1fr] md:rounded-t-[34px]"
      >
        <aside className="hidden flex-col gap-2 border-r border-cream-line px-5 py-10 md:flex">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => pick(x.id)}
              className={`rounded-[10px] p-3 text-left text-sm ${tab === x.id ? "bg-forest-soft font-bold text-forest" : "text-cream-muted hover:bg-black/[0.03]"}`}
            >
              {x.icon} <span>{x.label}</span>
            </button>
          ))}
          <MiniWallet />
        </aside>

        <div className="min-w-0 p-[18px] md:p-10">
          <AskCard messages={chat.messages} busy={chat.busy} hasItinerary={!!itinerary} onSend={(s) => void chat.send(s)} onReset={chat.reset} />

          <div className="mt-8 mb-4 flex flex-wrap items-end justify-between gap-3 md:mt-10 md:mb-5">
            <div>
              <span className="text-[11px] font-extrabold tracking-[2px] text-forest">{t.curatedForYou}</span>
              <h2 className="mt-1 font-display text-[26px] font-extrabold md:text-[30px]">
                {tab === "map"
                  ? t.mapTitle
                  : tab === "saved"
                    ? t.savedTitle
                    : dish
                      ? t.dishNear.replace("{dish}", dishLabel(dish, locale))
                      : area
                        ? t.discoverNear.replace("{area}", area)
                        : t.discoverTitle}
              </h2>
            </div>
            <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-white p-1 md:hidden" role="tablist">
              {(["discover", "map", "saved"] as Tab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${tab === id ? "bg-forest-soft text-forest" : "text-cream-muted"}`}
                >
                  {id === "discover" ? t.tabDiscover : id === "map" ? t.tabMap : t.tabSaved}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTab(tab === "map" ? "discover" : "map")}
              className="hidden min-h-11 items-center text-sm font-semibold text-[#168162] hover:underline md:inline-flex"
            >
              {tab === "map" ? t.viewCards : `${t.viewMap} ↗`}
            </button>
          </div>

          {dishes.length > 0 && tab !== "saved" && (
            <div className="mb-4 md:mb-5">
              <p className="mb-2 text-xs font-semibold text-cream-muted md:hidden">
                🍜 {area ? t.dishesTitle.replace("{area}", area) : t.dishesTitleGeneric}
              </p>
            <div className="-mx-[18px] flex items-center gap-2 overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
              <span className="mr-1 hidden text-xs font-semibold text-cream-muted md:inline">
                🍜 {area ? t.dishesTitle.replace("{area}", area) : t.dishesTitleGeneric}
              </span>
              {dishes.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => void pickDish(d)}
                  aria-pressed={dish === d}
                  className={`fx-press min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition ${
                    dish === d ? "border-forest bg-forest text-white" : "border-cream-line bg-white text-cream-ink hover:border-forest"
                  }`}
                >
                  {dishLabel(d, locale)}
                  {dish === d ? " ✕" : ""}
                </button>
              ))}
            </div>
            </div>
          )}

          {dish && dishState === "ok" && dishPlaces.length === 0 && tab === "discover" && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[17px] border border-dashed border-cream-line bg-white p-4 text-sm text-cream-muted">
              <span>{degraded ? t.mapDataBusy : t.dishEmpty.replace("{dish}", dishLabel(dish, locale))}</span>
              <button
                type="button"
                onClick={() => void chat.send(t.askDish.replace("{dish}", dishLabel(dish, locale)))}
                className="min-h-10 rounded-lg bg-forest-soft px-3 text-sm font-bold text-forest"
              >
                {t.askButton} →
              </button>
            </div>
          )}
          {dish && dishState === "error" && (
            <p role="alert" className="mb-4 rounded-xl bg-[#fde8e4] px-3 py-2 text-sm text-[#b5452b]">
              {t.poiError}
            </p>
          )}

          {placesState === "error" && (
            <p role="alert" className="mb-4 rounded-xl bg-[#fde8e4] px-3 py-2 text-sm text-[#b5452b]">
              {t.poiError}{" "}
              <button type="button" className="min-h-10 font-semibold underline" onClick={() => start && loadPlaces(start)}>
                {t.retry}
              </button>
            </p>
          )}

          {tab === "map" ? (
            <div id="map-view" className="relative h-[62dvh] min-h-[380px] scroll-mt-20 overflow-hidden rounded-[17px] border border-[#dfe5df] md:h-[560px]">
              <MapView center={start ?? CENTER} user={start?.isGps ? start : null} places={places} itinerary={itinerary} t={t} />
            </div>
          ) : (placesState === "loading" && places.length === 0) || (dish && dishState === "loading") ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-[18px] lg:grid-cols-3" aria-busy>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="fx-skeleton fx-skeleton-light h-[150px] rounded-2xl bg-white sm:h-[300px] sm:rounded-[17px]" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-[17px] border border-dashed border-cream-line p-6 text-sm text-cream-muted">
              {tab === "saved" ? t.savedEmpty : degraded ? t.mapDataBusy : t.none}{" "}
              {tab !== "saved" && start && (
                <button type="button" className="min-h-10 font-semibold text-forest underline" onClick={() => loadPlaces(start)}>
                  {t.retry}
                </button>
              )}
            </p>
          ) : (
            <>
              <PlaceCards places={visible} saved={saved} onToggleSave={toggleSave} onAdd={addToPlan} busy={chat.busy} />
              {tab === "discover" && !dish && sorted.length > limit && (
                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + PAGE)}
                    className="min-h-11 w-full rounded-xl border border-cream-line bg-white px-5 text-sm font-semibold text-forest sm:w-auto"
                  >
                    {t.showMore}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <ItineraryTimeline itinerary={itinerary} />
    </div>
  );
}
