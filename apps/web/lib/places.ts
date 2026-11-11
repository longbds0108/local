import { CITY } from "./env";
import { merchantsData, poisData } from "./data";
import { haversineKm, type LatLon } from "./geo";
import { openDuringWindow } from "./hours";
import { normalizeVi } from "./landmarks";
import { ofmPois } from "./ofm-pois";
import { openingHoursFor, type OsmPoi } from "./overpass";
import { photonAreaPois, photonDishPois } from "./photon-pois";
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
    seedCache = (poisData as { pois: SeedPoi[] }).pois;
  }
  return seedCache;
}

export function loadMerchantSeed(): MerchantSeed[] {
  if (!merchantCache) {
    merchantCache = (merchantsData as { merchants: MerchantSeed[] }).merchants;
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
  /** Name keyword (e.g. a dish: "phở", "cơm tấm") — searches food places by name. */
  keyword?: string;
  /** Interleave categories instead of pure distance order (for browsing). */
  mixCategories?: boolean;
};

export type SearchResult = Place & { distanceM: number; openDuringWindow: boolean | null };

function mixByCategory(list: SearchResult[]): SearchResult[] {
  const groups = new Map<string, SearchResult[]>();
  for (const p of list) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
  const queues = [...groups.values()];
  const out: SearchResult[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/** Keep the first occurrence of each OSM element (earlier lists win). */
function mergeOsm(...lists: OsmPoi[][]): OsmPoi[] {
  const byId = new Map<string, OsmPoi>();
  for (const l of lists) for (const p of l) if (!byId.has(p.osmId)) byId.set(p.osmId, p);
  return [...byId.values()];
}

export async function searchPlaces(params: SearchParams): Promise<SearchResult[]> {
  const { lat, lon } = params;
  const radiusM = Math.min(Math.max(params.radiusM, 300), 8000);
  const cats = (params.categories ?? []).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
  const limit = Math.min(Math.max(params.limit ?? 15, 1), 40);
  const kw = params.keyword ? normalizeVi(params.keyword) : null;

  let seed = loadSeedPois().map(fromSeed);
  let osm: OsmPoi[];
  const tiles = ofmPois(lat, lon, radiusM); // reliable CDN source (OSM data, no opening hours)
  if (kw) {
    seed = seed.filter((p) => normalizeVi(p.name).includes(kw) || (p.tags ?? []).some((t) => normalizeVi(t.replace(/_/g, " ")).includes(kw)));
    const fromTiles = (await tiles).filter(
      (p) => (p.category === "restaurant" || p.category === "cafe") && normalizeVi(p.name).includes(kw),
    );
    // Photon only as a supplement when the tiles have few matches.
    osm = fromTiles.length >= 5 ? fromTiles : mergeOsm(fromTiles, await photonDishPois(params.keyword!, lat, lon, radiusM));
  } else {
    // Tiles always; Photon (if configured/reachable) only when the tiles are thin.
    osm = await tiles;
    if (osm.length < 10) osm = mergeOsm(osm, await photonAreaPois(lat, lon, radiusM));
  }

  // Merge: seed wins (it has prices + merchants). Also drop OSM duplicates of seed
  // entries that are the same place mapped as a different element.
  const merged = new Map<string, Place>();
  for (const p of seed) merged.set(p.osmId, p);
  for (const o of osm) {
    if (merged.has(o.osmId)) continue;
    // Some OSM "names" are really descriptions/reviews — not usable as a place name.
    if (o.name.length > 60) continue;
    const dup = seed.some(
      (s) => s.name.toLowerCase() === o.name.toLowerCase() && haversineKm(s, o) < 0.3,
    );
    if (dup) continue;
    const price = unitPrice({ category: o.category });
    merged.set(o.osmId, { ...o, priceUsdc: price.unit, priceSource: price.source, source: "osm" });
  }

  const here: LatLon = { lat, lon };
  let results: SearchResult[] = [...merged.values()]
    .map((p) => ({ ...p, distanceM: Math.round(haversineKm(here, p) * 1000), openDuringWindow: null as boolean | null }))
    .filter((p) => p.distanceM <= radiusM)
    .filter((p) => cats.length === 0 || cats.includes(p.category));

  // Seed places first (curated, have prices/merchants), then by distance.
  results.sort((a, b) => (a.source === b.source ? a.distanceM - b.distanceM : a.source === "seed" ? -1 : 1));
  if (params.mixCategories) results = mixByCategory(results);

  // Opening hours (tiles don't carry them): ask Overpass by id for the candidates only.
  results = results.slice(0, limit * 2);
  const needHours = results.filter((p) => p.source === "osm" && !p.openingHours).map((p) => p.osmId);
  if (needHours.length) {
    const hours = await openingHoursFor(needHours, params.osmWaitMs ?? 4000);
    for (const p of results) if (!p.openingHours && hours.has(p.osmId)) p.openingHours = hours.get(p.osmId);
  }
  if (params.windowStart && params.windowEnd) {
    for (const p of results) p.openDuringWindow = openDuringWindow(p.openingHours, params.windowStart, params.windowEnd);
    // Spec: skip POIs whose opening_hours show they are closed during the window.
    results = results.filter((p) => p.openDuringWindow !== false);
  }
  results = results.slice(0, limit);
  remember(results);
  return results;
}

/** Places for the map layer: seed + OSM around a point, no opening-hours filter. */
export async function placesForMap(lat: number, lon: number, radiusM: number, keyword?: string): Promise<SearchResult[]> {
  return searchPlaces({ lat, lon, radiusM, limit: 40, osmWaitMs: 3_000, keyword, mixCategories: !keyword });
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
