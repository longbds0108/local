import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { isOpenAt } from "@/lib/hours";
import { placesForMap, searchPlaces } from "@/lib/places";
import { rateLimit } from "@/lib/rate-limit";
import type { MapPlace } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(300).max(8000).default(5000),
  categories: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
  /** Dish / name keyword, e.g. "phở" — food places whose name matches. */
  q: z.string().trim().min(2).max(60).optional(),
});

export const GET = handle(async (req: Request) => {
  if (!rateLimit(`places:${clientIp(req)}`, 60, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const q = parseQuery(req, Query);
  const results = q.categories
    ? await searchPlaces({ lat: q.lat, lon: q.lon, radiusM: q.radius, categories: q.categories.split(","), limit: q.limit })
    : await placesForMap(q.lat, q.lon, q.radius, q.q);
  const now = new Date();
  const places: MapPlace[] = results.map((p) => ({
    openNow: isOpenAt(p.openingHours, now),
    osmId: p.osmId,
    name: p.name,
    nameEn: p.nameEn,
    lat: p.lat,
    lon: p.lon,
    category: p.category,
    openingHours: p.openingHours,
    priceUsdc: p.priceUsdc,
    priceSource: p.priceSource,
    merchantId: p.merchantId,
    distanceM: p.distanceM,
    source: p.source,
  }));
  // degraded: the OSM sources (map tiles) could not be reached — only seed data was searched.
  const degraded = !q.q && !results.some((p) => p.source === "osm");
  return NextResponse.json({ places, degraded });
});
