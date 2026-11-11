"use client";

import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";

/** Minimal shape of a GeoJSON source we update. */
type GeoJSONSource = { setData(data: GeoJSON.GeoJSON): unknown };
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLORS, CATEGORY_EMOJI, distance, hhmm } from "@/lib/format";
import type { Dict } from "@/lib/i18n";
import type { ItineraryView, MapPlace } from "@/lib/types";

// Map style (all built from OpenStreetMap data):
//  1. NEXT_PUBLIC_MAP_STYLE_URL — any MapLibre style URL
//  2. NEXT_PUBLIC_MAP_TILE_URL  — a raster tile template ({z}/{x}/{y})
//  3. default: OpenFreeMap "liberty" vector style (free, no API key).
// (tile.openstreetmap.org is unreachable from some networks, CARTO now needs a key.)
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const CUSTOM_TILES = process.env.NEXT_PUBLIC_MAP_TILE_URL;

/**
 * Map data credit in the UI language. MapLibre's own attribution control would
 * show the style's English credit line, so this replaces it (same CSS classes).
 * The HTML comes from our dictionary only, never from map data.
 */
class CreditControl implements maplibregl.IControl {
  private el: HTMLElement | null = null;
  constructor(private html: string) {}
  onAdd() {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl maplibregl-ctrl-attrib";
    el.innerHTML = `<div class="maplibregl-ctrl-attrib-inner">${this.html}</div>`;
    this.el = el;
    return el;
  }
  onRemove() {
    this.el?.remove();
    this.el = null;
  }
}

function mapStyle(): string | StyleSpecification {
  if (process.env.NEXT_PUBLIC_MAP_STYLE_URL) return process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  if (CUSTOM_TILES) {
    return {
      version: 8,
      sources: { base: { type: "raster", tiles: [CUSTOM_TILES], tileSize: 256, maxzoom: 19 } },
      layers: [{ id: "base", type: "raster", source: "base" }],
    };
  }
  return DEFAULT_STYLE_URL;
}

// Worker is copied to /public by scripts/copy-maplibre-worker.mjs (predev/prebuild).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type Props = {
  center: { lat: number; lon: number };
  user: { lat: number; lon: number } | null;
  places: MapPlace[];
  itinerary: ItineraryView | null;
  t: Dict;
};

function placesGeoJSON(places: MapPlace[], highlighted: Set<string>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { osmId: p.osmId, category: p.category, inPlan: highlighted.has(p.osmId) ? 1 : 0 },
    })),
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Popup content built with DOM APIs (OSM names are untrusted text — no innerHTML). */
function popupNode(p: MapPlace, t: Dict): HTMLElement {
  const root = document.createElement("div");
  root.className = "payagent-popup";
  const title = document.createElement("div");
  title.className = "hp-title";
  title.textContent = `${CATEGORY_EMOJI[p.category] ?? "📍"} ${p.name}`;
  const meta = document.createElement("div");
  meta.className = "hp-meta";
  meta.textContent = `${t.category[p.category] ?? p.category} · ${t.distance} ${distance(p.distanceM)}`;
  const price = document.createElement("div");
  price.className = "hp-price";
  price.textContent =
    p.priceUsdc > 0
      ? `${p.priceUsdc} USDC${t.perPerson} (${p.priceSource === "estimate" ? t.estimate : t.demoPrice})`
      : t.free;
  const hours = document.createElement("div");
  hours.className = "hp-hours";
  hours.textContent = p.openingHours ? `${t.openingHours}: ${p.openingHours}` : t.unknownHours;
  root.append(title, meta, price, hours);
  return root;
}

/** Remount on language change so MapLibre's built-in control labels follow the UI language. */
export default function MapView(props: Props) {
  return <MapCanvas key={props.t.langToggle} {...props} />;
}

function MapCanvas({ center, user, places, itinerary, t }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const placesRef = useRef<MapPlace[]>(places);
  const tRef = useRef(t);
  const [loaded, setLoaded] = useState(false);

  placesRef.current = places;
  tRef.current = t;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: [center.lon, center.lat],
      zoom: 13.2,
      attributionControl: false,
      // On phones, one finger scrolls the page; two fingers move the map.
      cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
      locale: {
        "CooperativeGesturesHandler.MobileHelpText": tRef.current.mapTwoFingers,
        "CooperativeGesturesHandler.WindowsHelpText": tRef.current.mapCtrlScroll,
        "CooperativeGesturesHandler.MacHelpText": tRef.current.mapCmdScroll,
        "NavigationControl.ZoomIn": tRef.current.mapZoomIn,
        "NavigationControl.ZoomOut": tRef.current.mapZoomOut,
        "NavigationControl.ResetBearing": tRef.current.mapResetBearing,
        "Map.Title": tRef.current.mapLabel,
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new CreditControl(tRef.current.mapCredit), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0E7C86", "line-width": 4.5 },
      });

      map.addSource("places", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "places",
        type: "circle",
        source: "places",
        paint: {
          "circle-radius": ["case", ["==", ["get", "inPlan"], 1], 4, 7],
          "circle-color": [
            "match",
            ["get", "category"],
            ...Object.entries(CATEGORY_COLORS).flat(),
            "#0E7C86",
          ] as unknown as maplibregl.ExpressionSpecification,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": ["case", ["==", ["get", "inPlan"], 1], 0.5, 0.95],
        },
      });

      map.on("click", "places", (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        const osmId = f?.properties?.osmId as string | undefined;
        const p = placesRef.current.find((x) => x.osmId === osmId);
        if (!p) return;
        new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 10 })
          .setLngLat([p.lon, p.lat])
          .setDOMContent(popupNode(p, tRef.current))
          .addTo(map);
      });
      map.on("mouseenter", "places", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "places", () => (map.getCanvas().style.cursor = ""));
      setLoaded(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Places layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const inPlan = new Set(itinerary?.stops.map((s) => s.osmId) ?? []);
    (map.getSource("places") as GeoJSONSource | undefined)?.setData(placesGeoJSON(places, inPlan));
  }, [places, itinerary, loaded]);

  // User location marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!user) return;
    const el = document.createElement("div");
    el.className = "user-dot";
    userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([user.lon, user.lat]).addTo(map);
  }, [user]);

  // Re-center when the starting point changes (GPS resolved).
  useEffect(() => {
    mapRef.current?.easeTo({ center: [center.lon, center.lat], duration: 600 });
  }, [center.lat, center.lon]);

  // Itinerary: route line + numbered stop markers + fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];
    const routeSrc = map.getSource("route") as GeoJSONSource | undefined;
    if (!itinerary) {
      routeSrc?.setData(EMPTY);
      return;
    }
    routeSrc?.setData(
      itinerary.geometry ? { type: "Feature", geometry: itinerary.geometry, properties: {} } : EMPTY,
    );
    const bounds = new maplibregl.LngLatBounds();
    itinerary.stops.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "stop-pin";
      el.textContent = String(i + 1);
      const popup = new maplibregl.Popup({ offset: 18, closeButton: false }).setText(`${i + 1}. ${s.name} · ${hhmm(s.arriveAt)}`);
      stopMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).setPopup(popup).addTo(map));
      bounds.extend([s.lon, s.lat]);
    });
    itinerary.geometry?.coordinates.forEach((c) => bounds.extend(c));
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: 50,
        maxZoom: 15,
        duration: 800,
      });
    }
  }, [itinerary, loaded]);

  // MapLibre adds `.maplibregl-map { position: relative }` (unlayered CSS beats
  // Tailwind's layered utilities), so size the map via a positioned wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label={t.mapLabel} />
    </div>
  );
}
