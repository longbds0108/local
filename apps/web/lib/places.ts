import { readFileSync } from "node:fs";
import path from "node:path";
import { CITY, config } from "./env";
import { haversineKm, type LatLon } from "./geo";
import { openDuringWindow } from "./hours";
import { fetchOsmPois } from "./overpass";
import { CATEGORIES, unitPrice, type Category, type PriceSource } from "./pricing";

export type SeedPoi = {
  osmId: string;
  name: string;
  nameEn?: string;
  lat: number;
  lon: number;
  category: Category;
  priceUsdc?: number;
  merchantId?: string;
  openingHours?: string;
  tags?: string[];
  suggestedMin?: number;
};

export type Place = {
  osmId: string;
  name: string;
  nameEn?: string;
  lat: number;
  lon: number;
  category: Category;
  openingHours?: string;
  cuisine?: string;
  tags?: string[];
  /** Per-person price in USDC. */
  priceUsdc: number;
  priceSource: PriceSource;
  merchantId?: string;
  suggestedMin?: number;
  source: "seed" | "osm";
};

export type MerchantSeed = { id: string; name: string; osmId: string; walletAddress: string };

let seedCache: SeedPoi[] | null = null;
let merchantCache: MerchantSeed[] | null = null;

export function loadSeedPois(): SeedPoi[] {
  if (!seedCache) {
    const raw = readFileSync(path.join(config.dataDir, "vungtau_pois.json"), "utf8");
    seedCache = (JSON.parse(raw) as { pois: SeedPoi[] }).pois;
  }
  return seedCache;
}

export function loadMerchantSeed(): MerchantSeed[] {
  if (!merchantCache) {
    const raw = readFileSync(path.join(config.dataDir, "merchants.json"), "utf8");
    merchantCache = (JSON.parse(raw) as { merchants: MerchantSeed[] }).merchants;
  }
  return merchantCache;
}

/** Fallback merchant for paid stops whose place has no merchant wallet of its own. */
export const PARTNER_POOL_MERCHANT_ID = "m_partner";

function fromSeed(p: SeedPoi): Place {
  const price = unitPrice(p);
  return {
    osmId: p.osmId,
    name: p.name,
    nameEn: p.nameEn,
    lat: p.lat,
    lon: p.lon,
    category: p.category,
    openingHours: p.openingHours,
    tags: p.tags,
    priceUsdc: price.unit,
    priceSource: price.source,
    merchantId: p.merchantId,
    suggestedMin: p.suggestedMin,
    source: "seed",
  };
}

// Every place returned to the AI is remembered so build_itinerary can verify that
// the osmIds it receives were really returned by search_places (no invented POIs).
const known = new Map<string, Place>();

function remember(places: Place[]) {
  for (const p of places) known.set(p.osmId, p);
}

export type SearchParams = {
  lat: number;
  lon: number;
  radiusM: number;
  categories?: string[];
  limit?: number;
  windowStart?: Date;
  windowEnd?: Date;
  /** Max time to wait for Overpass before answering with seed data only. */
  osmWaitMs?: number;
};

export type SearchResult = Place & { distanceM: number; openDuringWindow: boolean | null };

export async function searchPlaces(params: SearchParams): Promise<SearchResult[]> {
  const { lat, lon } = params;
  const radiusM = Math.min(Math.max(params.radiusM, 300), 8000);
  const cats = (params.categories ?? []).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
  const limit = Math.min(Math.max(params.limit ?? 15, 1), 40);

  const seed = loadSeedPois().map(fromSeed);
  const osm = await fetchOsmPois(lat, lon, radiusM, params.osmWaitMs ?? 12_000);

  // Merge: seed wins (it has prices + merchants). Also drop OSM duplicates of seed
  // entries that are the same place mapped as a different element.
  const merged = new Map<string, Place>();
  for (const p of seed) merged.set(p.osmId, p);
  for (const o of osm) {
    if (merged.has(o.osmId)) continue;
    const dup = seed.some(
      (s) => s.name.toLowerCase() === o.name.toLowerCase() && haversineKm(s, o) < 0.3,
    );
    if (dup) continue;
    const price = unitPrice({ category: o.category });
    merged.set(o.osmId, { ...o, priceUsdc: price.unit, priceSource: price.source, source: "osm" });
  }

  const here: LatLon = { lat, lon };
  let results: SearchResult[] = [...merged.values()]
    .map((p) => ({
      ...p,
      distanceM: Math.round(haversineKm(here, p) * 1000),
      openDuringWindow:
        params.windowStart && params.windowEnd ? openDuringWindow(p.openingHours, params.windowStart, params.windowEnd) : null,
    }))
    .filter((p) => p.distanceM <= radiusM)
    .filter((p) => cats.length === 0 || cats.includes(p.category))
    // Spec: skip POIs whose opening_hours show they are closed during the window.
    .filter((p) => p.openDuringWindow !== false);

  // Seed places first (curated, have prices/merchants), then by distance.
  results.sort((a, b) => (a.source === b.source ? a.distanceM - b.distanceM : a.source === "seed" ? -1 : 1));
  results = results.slice(0, limit);
  remember(results);
  return results;
}

/** Places for the map layer: seed + OSM around a point, no opening-hours filter. */
export async function placesForMap(lat: number, lon: number, radiusM: number): Promise<SearchResult[]> {
  return searchPlaces({ lat, lon, radiusM, limit: 40, osmWaitMs: 3_500 });
}

/**
 * Look up a place the AI referenced. Only places previously returned by search
 * (or seed data) are accepted. After a server restart, re-search around the city.
 */
export async function resolvePlace(osmId: string, near?: LatLon): Promise<Place | null> {
  const hit = known.get(osmId);
  if (hit) return hit;
  const seed = loadSeedPois().find((p) => p.osmId === osmId);
  if (seed) return fromSeed(seed);
  const center = near ?? CITY.center;
  await searchPlaces({ lat: center.lat, lon: center.lon, radiusM: 8000, limit: 40 });
  return known.get(osmId) ?? null;
}
