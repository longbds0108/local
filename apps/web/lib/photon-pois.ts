// POIs from Photon (OSM data) — used alongside Overpass, which is often
// overloaded. Photon needs a text query, so we run a few category queries
// restricted by OSM tag and a bounding box. Requests go through photonGet
// (disk cache + circuit breaker) to respect the public instance's fair use.
import type { OsmPoi } from "./overpass";
import { photonGet } from "./photon";
import type { Category } from "./pricing";

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: { osm_id: number; osm_type: "N" | "W" | "R"; osm_key: string; osm_value: string; name?: string };
};

const CATEGORY_BY_TAG: Record<string, Category> = {
  "amenity:restaurant": "restaurant",
  "amenity:fast_food": "restaurant",
  "amenity:food_court": "restaurant",
  "amenity:cafe": "cafe",
  "tourism:museum": "museum",
  "tourism:attraction": "attraction",
  "tourism:viewpoint": "viewpoint",
  "natural:beach": "beach",
  "amenity:place_of_worship": "attraction",
  "leisure:park": "attraction",
  "amenity:marketplace": "attraction",
  "historic:monument": "attraction",
  "historic:memorial": "attraction",
};

const FOOD_TAGS = ["amenity:restaurant", "amenity:fast_food", "amenity:food_court", "amenity:cafe"];

// Kept short on purpose (fair use): 6 requests per area, cached 24h on disk.
const AREA_QUERIES: { q: string; tags: string[] }[] = [
  { q: "quán", tags: ["amenity:restaurant", "amenity:fast_food"] },
  { q: "cà phê", tags: ["amenity:cafe"] },
  { q: "bảo tàng", tags: ["tourism:museum"] },
  { q: "chùa", tags: ["amenity:place_of_worship", "tourism:attraction"] },
  { q: "công viên", tags: ["leisure:park", "tourism:attraction"] },
  { q: "bãi biển", tags: ["natural:beach"] },
];

const DAY = 24 * 3600_000;

function bbox(lat: number, lon: number, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return `${(lon - dLon).toFixed(3)},${(lat - dLat).toFixed(3)},${(lon + dLon).toFixed(3)},${(lat + dLat).toFixed(3)}`;
}

async function query(q: string, tags: string[], lat: number, lon: number, radiusM: number, limit = 50): Promise<OsmPoi[]> {
  // Coordinates rounded (~1 km) so nearby users share cache entries.
  const params = new URLSearchParams({ q, lat: lat.toFixed(2), lon: lon.toFixed(2), bbox: bbox(lat, lon, radiusM), limit: String(limit), lang: "default" });
  for (const t of tags) params.append("osm_tag", t);
  const j = await photonGet<{ features?: Feature[] }>(`/api/?${params}`, DAY);
  const out: OsmPoi[] = [];
  for (const f of j?.features ?? []) {
    const p = f.properties;
    const category = CATEGORY_BY_TAG[`${p.osm_key}:${p.osm_value}`];
    if (!p.name || !category) continue;
    const type = p.osm_type === "N" ? "node" : p.osm_type === "W" ? "way" : "relation";
    out.push({ osmId: `${type}/${p.osm_id}`, name: p.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], category });
  }
  return out;
}

function dedupe(lists: OsmPoi[][]): OsmPoi[] {
  const byId = new Map<string, OsmPoi>();
  for (const l of lists) for (const p of l) if (!byId.has(p.osmId)) byId.set(p.osmId, p);
  return [...byId.values()];
}

/** Restaurants, cafes, museums, temples, parks, beaches around a point. */
export async function photonAreaPois(lat: number, lon: number, radiusM: number): Promise<OsmPoi[]> {
  const r = Math.min(Math.max(Math.round(radiusM / 1000) * 1000, 1000), 8000);
  const results: OsmPoi[][] = [];
  for (let i = 0; i < AREA_QUERIES.length; i += 3) {
    const batch = AREA_QUERIES.slice(i, i + 3);
    results.push(...(await Promise.all(batch.map((x) => query(x.q, x.tags, lat, lon, r)))));
  }
  return dedupe(results);
}

/** Food places whose name matches a dish, e.g. "phở", "cơm tấm". */
export function photonDishPois(dish: string, lat: number, lon: number, radiusM: number): Promise<OsmPoi[]> {
  const r = Math.min(Math.max(Math.round(radiusM / 1000) * 1000, 1000), 8000);
  return query(dish.toLowerCase(), FOOD_TAGS, lat, lon, r, 40);
}
