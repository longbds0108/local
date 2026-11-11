// Opening hours from OpenStreetMap via Overpass — the only source that has them.
// Places themselves come from vector tiles (lib/ofm-pois.ts); here we only ask
// Overpass for the `opening_hours` tag of the places actually being shown, by
// OSM id: one small request, cached 7 days on disk. Several endpoints are tried
// in order (OVERPASS_URL, comma-separated); a failing endpoint is skipped for a
// while. overpass-api.de is often overloaded/unreachable, so the French
// community instance is tried first by default.
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

const DEFAULT_ENDPOINTS = ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter"];
const HOURS_TTL_MS = 7 * 24 * 3600_000;
const ENDPOINT_BREAK_MS = 10 * 60_000;
const downUntil = new Map<string, number>();

function endpoints(): string[] {
  const raw = process.env.OVERPASS_URL?.trim();
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ENDPOINTS;
  return list.filter((e) => (downUntil.get(e) ?? 0) <= Date.now());
}

async function overpass(query: string): Promise<{ elements: { type: string; id: number; tags?: Record<string, string> }[] } | null> {
  for (const url of endpoints()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Toura/0.1 (demo)" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return await res.json();
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      downUntil.set(url, Date.now() + ENDPOINT_BREAK_MS);
      console.warn(`[overpass] ${new URL(url).host} failed (${(err as Error).message}) — trying next endpoint`);
    }
  }
  return null;
}

// ---- disk cache: osmId → opening_hours (null = OSM has no tag) ---------------
type HoursCache = Record<string, { at: number; v: string | null }>;
let memo: HoursCache | null = null;
const cacheFile = () => path.join(config.cacheDir, "opening-hours.json");

async function loadCache(): Promise<HoursCache> {
  if (memo) return memo;
  try {
    memo = JSON.parse(await fs.readFile(cacheFile(), "utf8")) as HoursCache;
  } catch {
    memo = {};
  }
  return memo;
}

async function saveCache() {
  try {
    await fs.mkdir(path.dirname(cacheFile()), { recursive: true });
    await fs.writeFile(cacheFile(), JSON.stringify(memo ?? {}));
  } catch {
    /* best effort */
  }
}

const inflight = new Map<string, Promise<void>>();

async function fetchHours(ids: string[]): Promise<void> {
  const nodes = ids.filter((i) => i.startsWith("node/")).map((i) => i.slice(5));
  const ways = ids.filter((i) => i.startsWith("way/")).map((i) => i.slice(4));
  if (!nodes.length && !ways.length) return;
  const q = `[out:json][timeout:15];(${nodes.length ? `node(id:${nodes.join(",")});` : ""}${ways.length ? `way(id:${ways.join(",")});` : ""});out tags;`;
  const res = await overpass(q);
  if (!res) return; // all endpoints down — try again next time
  const cache = await loadCache();
  const now = Date.now();
  const found = new Map(res.elements.map((e) => [`${e.type}/${e.id}`, e.tags?.opening_hours ?? null]));
  for (const id of ids) cache[id] = { at: now, v: found.get(id) ?? null };
  await saveCache();
}

/**
 * opening_hours for the given OSM ids (node/way). Waits at most `waitMs`; the
 * lookup keeps running in the background and fills the cache for next time.
 */
export async function openingHoursFor(osmIds: string[], waitMs = 4000): Promise<Map<string, string>> {
  const cache = await loadCache();
  const now = Date.now();
  const missing = osmIds.filter(
    (id) => /^(node|way)\/\d+$/.test(id) && !(cache[id] && now - cache[id].at < HOURS_TTL_MS),
  );
  if (missing.length) {
    const key = missing.slice(0, 120).sort().join(",");
    let job = inflight.get(key);
    if (!job) {
      job = fetchHours(missing.slice(0, 120)).finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    await Promise.race([job, new Promise((r) => setTimeout(r, waitMs))]);
  }
  const out = new Map<string, string>();
  for (const id of osmIds) {
    const v = cache[id]?.v;
    if (v) out.set(id, v);
  }
  return out;
}
