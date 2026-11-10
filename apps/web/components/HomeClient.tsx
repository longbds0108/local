"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSession } from "@/lib/circle-client";
import type { ItineraryView, MapPlace } from "@/lib/types";
import { useChat } from "@/lib/use-chat";
import AskCard from "./home/AskCard";
import Hero, { type GpsState } from "./home/Hero";
import ItineraryTimeline from "./home/ItineraryTimeline";
import PlaceCards from "./home/PlaceCards";
import { useI18n } from "./I18nProvider";

const MapView = dynamic(() => import("./Map"), { ssr: false });

const CENTER = { lat: 10.346, lon: 107.0843 };
const MAX_KM = 30;
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
    const s = getSession();
    if (!s?.walletAddress) return;
    setAddr(s.walletAddress);
    fetch(`/api/balance?address=${s.walletAddress}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBalance(Number(j.usdc).toFixed(2)))
      .catch(() => {});
  }, []);
  return (
    <div className="mt-auto rounded-2xl bg-[#0c2621] p-4 text-white">
      <small className="text-[9px] tracking-[1px] text-[#84a59b]">{t.travelWallet}</small>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-xs">{t.usdcBalance}</span>
        <b className="text-[22px]">{addr ? (balance ?? "…") : "—"}</b>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#b9cbc5]">
        <i className="inline-block h-[7px] w-[7px] rounded-full bg-accent" /> Arc Testnet
      </div>
      {!addr && <p className="mt-2 text-[10px] text-[#84a59b]">{t.walletHint}</p>}
    </div>
  );
}

export default function HomeClient() {
  const { t } = useI18n();
  const [gps, setGps] = useState<GpsState>("locating");
  const [start, setStart] = useState<{ lat: number; lon: number; isGps: boolean } | null>(null);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [placesState, setPlacesState] = useState<"loading" | "ok" | "error">("loading");
  const [itinerary, setItinerary] = useState<ItineraryView | null>(null);
  const [tab, setTab] = useState<Tab>("discover");
  const [limit, setLimit] = useState(PAGE);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  // [1] GPS with fallback to the Vũng Tàu center.
  const locate = useCallback(() => {
    setGps("locating");
    if (!("geolocation" in navigator)) {
      setGps("denied");
      setStart({ ...CENTER, isGps: false });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (km(here, CENTER) <= MAX_KM) {
          setGps("ok");
          setStart({ ...here, isGps: true });
        } else {
          setGps("far");
          setStart({ ...CENTER, isGps: false });
        }
      },
      () => {
        setGps("denied");
        setStart({ ...CENTER, isGps: false });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
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
      const res = await fetch(`/api/places?lat=${p.lat}&lon=${p.lon}&radius=6000`);
      if (!res.ok) throw new Error(String(res.status));
      setPlaces(((await res.json()) as { places: MapPlace[] }).places);
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

  const chat = useChat({ start, onItinerary, onPlaces });

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

  const sorted = useMemo(() => [...places].sort((a, b) => a.distanceM - b.distanceM), [places]);
  const visible = tab === "saved" ? sorted.filter((p) => saved.has(p.osmId)) : sorted.slice(0, limit);

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

      <Hero gps={gps} onUpdateLocation={locate} />

      <section
        id="explore"
        className="mx-auto grid min-h-[700px] max-w-[1440px] scroll-mt-20 rounded-t-[24px] bg-cream text-cream-ink md:grid-cols-[210px_1fr] md:rounded-t-[34px]"
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

          <div className="mt-10 mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="text-[11px] font-extrabold tracking-[2px] text-forest">{t.curatedForYou}</span>
              <h2 className="mt-1 font-display text-[26px] font-extrabold md:text-[30px]">
                {tab === "map" ? t.mapTitle : tab === "saved" ? t.savedTitle : t.discoverTitle}
              </h2>
            </div>
            <div className="flex gap-1 rounded-xl bg-white p-1 md:hidden">
              {(["discover", "map", "saved"] as Tab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === id ? "bg-forest-soft text-forest" : "text-cream-muted"}`}
                >
                  {id === "discover" ? t.tabDiscover : id === "map" ? t.tabMap : t.tabSaved}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setTab(tab === "map" ? "discover" : "map")}
              className="hidden text-sm font-semibold text-[#168162] hover:underline md:block"
            >
              {tab === "map" ? t.viewCards : `${t.viewMap} ↗`}
            </button>
          </div>

          {placesState === "error" && (
            <p role="alert" className="mb-4 rounded-xl bg-[#fde8e4] px-3 py-2 text-sm text-[#b5452b]">
              {t.poiError}{" "}
              <button type="button" className="font-semibold underline" onClick={() => start && loadPlaces(start)}>
                {t.retry}
              </button>
            </p>
          )}

          {tab === "map" ? (
            <div className="relative h-[460px] overflow-hidden rounded-[17px] border border-[#dfe5df] md:h-[560px]">
              <MapView center={start ?? CENTER} user={start?.isGps ? start : null} places={places} itinerary={itinerary} t={t} />
            </div>
          ) : placesState === "loading" && places.length === 0 ? (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3" aria-busy>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[300px] animate-pulse rounded-[17px] bg-white" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="rounded-[17px] border border-dashed border-cream-line p-6 text-sm text-cream-muted">
              {tab === "saved" ? t.savedEmpty : t.none}
            </p>
          ) : (
            <>
              <PlaceCards places={visible} saved={saved} onToggleSave={toggleSave} onAdd={addToPlan} busy={chat.busy} />
              {tab === "discover" && sorted.length > limit && (
                <div className="mt-6 text-center">
                  <button
                    type="button"
                    onClick={() => setLimit((l) => l + PAGE)}
                    className="rounded-xl border border-cream-line bg-white px-5 py-2.5 text-sm font-semibold text-forest"
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
