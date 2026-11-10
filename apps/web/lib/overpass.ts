// OpenStreetMap POIs via Overpass. Results are cached 24h (memory + disk) and
// requests are de-duplicated, per the Overpass usage policy.
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./env";
import type { Category } from "./pricing";

export type OsmPoi = {
  osmId: string; // "node/123" | "way/456"
  name: string;
  lat: number;
  lon: number;
  category: Category;
  openingHours?: string;
  cuisine?: string;
};

const TTL_MS = 24 * 60 * 60 * 1000;
const memory = new Map<string, { at: number; pois: OsmPoi[] }>();
const inflight = new Map<string, Promise<OsmPoi[]>>();

function buildQuery(lat: number, lon: number, r: number): string {
  // Query from the spec, plus a [name] filter (unnamed POIs are useless for itineraries).
  return `[out:json][timeout:25];
(
  node(around:${r},${lat},${lon})[tourism~"attraction|viewpoint|museum"][name];
  node(around:${r},${lat},${lon})[amenity~"restaurant|cafe"][name];
  node(around:${r},${lat},${lon})[natural=beach][name];
  way(around:${r},${lat},${lon})[natural=beach][name];
  way(around:${r},${lat},${lon})[tourism~"attraction|viewpoint|museum"][name];
);
out center 200;`;
}

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function categorize(tags: Record<string, string>): Category | null {
  if (tags.natural === "beach") return "beach";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism === "museum") return "museum";
  if (tags.tourism === "attraction") return "attraction";
  if (tags.amenity === "restaurant") return "restaurant";
  if (tags.amenity === "cafe") return "cafe";
  return null;
}

function normalize(el: OverpassElement): OsmPoi | null {
  const tags = el.tags ?? {};
  const name = tags["name:vi"] ?? tags.name;
  const pos = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
  const category = categorize(tags);
  if (!name || !pos || !category) return null;
  return {
    osmId: `${el.type}/${el.id}`,
    name,
    lat: pos.lat,
    lon: pos.lon,
    category,
    openingHours: tags.opening_hours,
    cuisine: tags.cuisine,
  };
}

/** ~1km grid so small GPS jitter reuses the same cache entry. */
function cacheKey(lat: number, lon: number, r: number) {
  return `${lat.toFixed(2)}_${lon.toFixed(2)}_${Math.ceil(r / 1000)}k`;
}

async function readDisk(key: string): Promise<{ at: number; pois: OsmPoi[] } | null> {
  try {
    const raw = await fs.readFile(path.join(config.dataDir, "cache", `overpass-${key}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeDisk(key: string, value: { at: number; pois: OsmPoi[] }) {
  try {
    const dir = path.join(config.dataDir, "cache");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `overpass-${key}.json`), JSON.stringify(value));
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Never throws: on network/Overpass errors returns [] (seed data still works).
 * `waitMs`: give up waiting after this long and return [] — the request keeps
 * running in the background and fills the cache for the next call.
 */
export async function fetchOsmPois(lat: number, lon: number, radiusM: number, waitMs?: number): Promise<OsmPoi[]> {
  const p = fetchOsmPoisInner(lat, lon, radiusM);
  if (!waitMs) return p;
  return Promise.race([p, new Promise<OsmPoi[]>((r) => setTimeout(() => r([]), waitMs))]);
}

async function fetchOsmPoisInner(lat: number, lon: number, radiusM: number): Promise<OsmPoi[]> {
  const r = Math.min(Math.max(Math.round(radiusM), 300), 8000);
  const qLat = Number(lat.toFixed(2));
  const qLon = Number(lon.toFixed(2));
  const key = cacheKey(qLat, qLon, r);

  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pois;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const disk = await readDisk(key);
    if (disk && Date.now() - disk.at < TTL_MS) {
      memory.set(key, disk);
      return disk.pois;
    }
    try {
      const res = await fetch(config.overpassUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HedgoraTravel/0.1 (demo)" },
        body: new URLSearchParams({ data: buildQuery(qLat, qLon, r) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      const pois = json.elements.map(normalize).filter((x): x is OsmPoi => x !== null);
      const entry = { at: Date.now(), pois };
      memory.set(key, entry);
      await writeDisk(key, entry);
      return pois;
    } catch (err) {
      console.warn("[overpass] fetch failed, using seed/stale data only:", (err as Error).message);
      if (disk) return disk.pois; // stale is better than nothing
      return [];
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
