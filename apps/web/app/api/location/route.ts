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
  // Optional result of the browser-side reverse geocode (most local first),
  // so the server doesn't depend on a single geocoder.
  label: z.string().trim().max(160).optional(),
  names: z.string().trim().max(300).optional(),
  country: z.string().trim().max(80).optional(),
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

  const clientNames = q.names?.split("|").map((x) => x.trim()).filter(Boolean) ?? [];
  const useClient = !!q.label && clientNames.length > 0;
  // Photon only when the browser couldn't resolve the place.
  const [props, weather] = await Promise.all([
    useClient ? Promise.resolve(null) : reverseGeocode(q.lat, q.lon),
    currentWeather(q.lat, q.lon),
  ]);
  const fields = useClient
    ? clientNames
    : props
      ? [props.locality, props.district, props.name, props.city, props.county, props.state]
      : [];
  const landmark: Landmark | null = findLandmark(fields);
  const country = useClient ? (q.country ?? null) : (props?.country ?? null);
  const inVietnam = !country || /vi[eệ]t\s*nam/i.test(country);

  return NextResponse.json({
    label: useClient ? q.label : placeLabel(props),
    country,
    weather,
    landmark,
    dishes: inVietnam ? dishesFor(landmark?.id) : [],
  });
});
