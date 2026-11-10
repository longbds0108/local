import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { config } from "@/lib/env";
import { placeLabel, reverseGeocode } from "@/lib/geocode";
import { findLandmark, type Landmark } from "@/lib/landmarks";
import { rateLimit } from "@/lib/rate-limit";
import { currentWeather } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

let specialties: { default: string[]; dishes: Record<string, string[]> } | null = null;
function dishesFor(landmarkId: string | undefined): string[] {
  specialties ??= JSON.parse(readFileSync(path.join(config.dataDir, "specialties.json"), "utf8"));
  return (landmarkId && specialties!.dishes[landmarkId]) || specialties!.default;
}

/**
 * GET /api/location?lat&lon → readable place name, current weather, the
 * best-known landmark photo (free-licensed, with credit) and local dishes.
 */
export const GET = handle(async (req: Request) => {
  if (!rateLimit(`location:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const q = parseQuery(req, Query);

  const [props, weather] = await Promise.all([reverseGeocode(q.lat, q.lon), currentWeather(q.lat, q.lon)]);
  const landmark: Landmark | null = props
    ? findLandmark([props.locality, props.district, props.name, props.city, props.county, props.state])
    : null;

  return NextResponse.json({
    label: placeLabel(props),
    country: props?.country ?? null,
    weather,
    landmark,
    dishes: props?.country && props.country !== "Việt Nam" && props.country !== "Vietnam" ? [] : dishesFor(landmark?.id),
  });
});
