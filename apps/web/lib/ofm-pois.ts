// POIs decoded from OpenFreeMap vector tiles (OpenMapTiles schema, OSM data) —
// the same CDN tiles the map already uses. Reliable when the public Overpass /
// Photon APIs are overloaded or rate-limiting. No opening hours in tiles.
import { VectorTile } from "@mapbox/vector-tile";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PbfReader } from "pbf";
import { config } from "./env";
import type { OsmPoi } from "./overpass";
import type { Category } from "./pricing";

const Z = 14; // OpenMapTiles carries every named POI at z14
const TILE_TTL_MS = 7 * 24 * 3600_000;
const TILEJSON_TTL_MS = 6 * 3600_000;

let tileTemplate: { url: string; at: number } | null = null;

async function template(): Promise<string | null> {
  if (tileTemplate && Date.now() - tileTemplate.at < TILEJSON_TTL_MS) return tileTemplate.url;
  const src = process.env.OFM_TILEJSON_URL?.trim() || "https://tiles.openfreemap.org/planet";
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return tileTemplate?.url ?? null;
    const url = ((await res.json()) as { tiles: string[] }).tiles[0];
    tileTemplate = { url, at: Date.now() };
    return url;
  } catch {
    return tileTemplate?.url ?? null;
  }
}

function categorize(cls: string, subclass: string): Category | null {
  if (subclass === "beach") return "beach";
  if (subclass === "viewpoint") return "viewpoint";
  switch (cls) {
    case "restaurant":
    case "fast_food":
      return "restaurant";
    case "cafe":
      return "cafe";
    case "museum":
      return "museum";
    case "attraction":
    case "place_of_worship":
    case "castle":
    case "monument":
    case "park":
      return "attraction";
    default:
      return subclass === "food_court" ? "restaurant" : null;
  }
}

const OSM_TYPE: Record<number, string> = { 1: "node", 2: "way", 3: "relation" };

function decode(buf: ArrayBuffer, x: number, y: number): OsmPoi[] {
  const layer = new VectorTile(new PbfReader(new Uint8Array(buf))).layers.poi;
  if (!layer) return [];
  const out: OsmPoi[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const p = f.properties as Record<string, string | number | undefined>;
    const name = (p["name:vi"] ?? p.name) as string | undefined;
    const category = categorize(String(p.class ?? ""), String(p.subclass ?? ""));
    if (!name || !category) continue;
    const geom = f.toGeoJSON(x, y, Z).geometry;
    if (geom.type !== "Point") continue;
    // OpenMapTiles feature id = osm_id * 10 + (1 node | 2 way | 3 relation)
    const id = typeof f.id === "number" ? f.id : undefined;
    const osmId = id && OSM_TYPE[id % 10] ? `${OSM_TYPE[id % 10]}/${Math.floor(id / 10)}` : `ofm/${Z}/${x}/${y}/${i}`;
    out.push({ osmId, name, lat: geom.coordinates[1], lon: geom.coordinates[0], category });
  }
  return out;
}

async function tilePois(x: number, y: number): Promise<OsmPoi[]> {
  const file = path.join(config.dataDir, "cache", `ofm-${Z}-${x}-${y}.json`);
  try {
    const { at, pois } = JSON.parse(await fs.readFile(file, "utf8")) as { at: number; pois: OsmPoi[] };
    if (Date.now() - at < TILE_TTL_MS) return pois;
  } catch {
    /* miss */
  }
  const tpl = await template();
  if (!tpl) return [];
  try {
    const res = await fetch(tpl.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y)), {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const pois = decode(await res.arrayBuffer(), x, y);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify({ at: Date.now(), pois }));
    } catch {
      /* cache is best-effort */
    }
    return pois;
  } catch {
    return [];
  }
}

function tileXY(lat: number, lon: number) {
  const n = 2 ** Z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
}

/** POIs from the z14 tiles around a point (center tile + up to 8 neighbours). */
export async function ofmPois(lat: number, lon: number, radiusM: number): Promise<OsmPoi[]> {
  const { x, y } = tileXY(lat, lon);
  const tileM = (40_075_016 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z;
  const k = radiusM > tileM / 2 ? 1 : 0; // 3x3 tiles (~±3.5 km) or just the centre tile
  const jobs: Promise<OsmPoi[]>[] = [];
  for (let dx = -k; dx <= k; dx++) for (let dy = -k; dy <= k; dy++) jobs.push(tilePois(x + dx, y + dy));
  const byId = new Map<string, OsmPoi>();
  for (const list of await Promise.all(jobs)) for (const p of list) if (!byId.has(p.osmId)) byId.set(p.osmId, p);
  return [...byId.values()];
}
