import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, handle, parseQuery } from "@/lib/api";
import { getItineraryView } from "@/lib/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ id: z.string().min(1).max(64) });

/** GET /api/itinerary?id=... → itinerary with stops (never includes QR secrets). */
export const GET = handle(async (req: Request) => {
  const { id } = parseQuery(req, Query);
  const view = await getItineraryView(id);
  if (!view) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  return NextResponse.json({ itinerary: view });
});
