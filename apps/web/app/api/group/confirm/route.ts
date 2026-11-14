import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { confirmShares } from "@/lib/group";
import { getItineraryView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ itineraryId: z.string().min(1).max(64) });

/** After a member's PIN step: confirm shares from the chain (never from the client). */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-confirm:${clientIp(req)}`, 60, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { itineraryId } = await parseJson(req, Body);
  const confirmed = await confirmShares(itineraryId);
  const itinerary = await getItineraryView(itineraryId);
  if (!itinerary || !itinerary.group) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  return NextResponse.json({ confirmed, itinerary });
});
