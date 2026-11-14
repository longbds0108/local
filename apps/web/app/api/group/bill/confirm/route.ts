import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { confirmBillParts } from "@/lib/group";
import { getItineraryView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ stopId: z.string().min(1).max(64) });

/** Confirm bill parts from the chain (never from the client); returns the trip. */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-bill-confirm:${clientIp(req)}`, 60, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { stopId } = await parseJson(req, Body);
  const stop = await prisma.stop.findUnique({ where: { id: stopId }, select: { itineraryId: true } });
  if (!stop) throw new ApiError(404, "NOT_FOUND", "Stop not found");
  await confirmBillParts(stopId);
  return NextResponse.json({ itinerary: await getItineraryView(stop.itineraryId) });
});
