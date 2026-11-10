// Routing via OSRM. The public demo server (router.project-osrm.org) only has a
// car profile, so for walking/bike we take its distances and apply typical
// speeds. A self-hosted OSRM with foot/bike profiles is used as-is.
import { config } from "./env";
import { haversineKm, type LatLon } from "./geo";

export type Profile = "driving" | "walking" | "bike";

export type RouteResult = {
  legs: { durationMin: number; distanceKm: number }[];
  geometry: { type: "LineString"; coordinates: [number, number][] };
  totalMin: number;
  totalKm: number;
  approximate: boolean;
};

const SPEED_KMH: Record<Exclude<Profile, "driving">, number> = { walking: 4.5, bike: 14 };
const OSRM_PROFILE: Record<Profile, string> = { driving: "driving", walking: "foot", bike: "bike" };

const cache = new Map<string, { at: number; value: RouteResult }>();
const TTL_MS = 60 * 60 * 1000;

function isPublicDemo() {
  return config.osrmUrl.includes("router.project-osrm.org");
}

function fallbackRoute(points: LatLon[], profile: Profile): RouteResult {
  // Straight-line × 1.3 detour factor; clearly marked approximate.
  const speed = profile === "driving" ? 25 : SPEED_KMH[profile];
  const legs = points.slice(1).map((p, i) => {
    const km = haversineKm(points[i], p) * 1.3;
    return { distanceKm: round1(km), durationMin: Math.max(1, Math.ceil((km / speed) * 60)) };
  });
  return {
    legs,
    geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) },
    totalMin: legs.reduce((s, l) => s + l.durationMin, 0),
    totalKm: round1(legs.reduce((s, l) => s + l.distanceKm, 0)),
    approximate: true,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export async function getRoute(points: LatLon[], profile: Profile = "driving"): Promise<RouteResult> {
  if (points.length < 2) {
    return { legs: [], geometry: { type: "LineString", coordinates: points.map((p) => [p.lon, p.lat]) }, totalMin: 0, totalKm: 0, approximate: false };
  }
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const key = `${profile}:${coords}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const osrmProfile = isPublicDemo() ? "driving" : OSRM_PROFILE[profile];
  const url = `${config.osrmUrl}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&steps=false`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HedgoraTravel/0.1 (demo)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const json = (await res.json()) as {
      code: string;
      routes?: { geometry: RouteResult["geometry"]; legs: { duration: number; distance: number }[] }[];
    };
    const route = json.routes?.[0];
    if (json.code !== "Ok" || !route) throw new Error(`OSRM code ${json.code}`);

    const scale = isPublicDemo() && profile !== "driving";
    const legs = route.legs.map((l) => {
      const km = l.distance / 1000;
      const min = scale ? (km / SPEED_KMH[profile as "walking" | "bike"]) * 60 : l.duration / 60;
      return { distanceKm: round1(km), durationMin: Math.max(1, Math.ceil(min)) };
    });
    const value: RouteResult = {
      legs,
      geometry: route.geometry,
      totalMin: legs.reduce((s, l) => s + l.durationMin, 0),
      totalKm: round1(legs.reduce((s, l) => s + l.distanceKm, 0)),
      approximate: scale,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.warn("[osrm] routing failed, using straight-line estimate:", (err as Error).message);
    return fallbackRoute(points, profile);
  }
}
