import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { getItineraryView, getItineraryWithStops } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  itineraryId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

/**
 * Turn a draft into a group trip (each member prepays their own share) or back.
 * The caller becomes the organizer; switching back is only possible before anyone paid.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-enable:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId, enabled } = await parseJson(req, Body);
  const it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Itinerary is already paid");
  if (it.endAt.getTime() <= Date.now()) throw new ApiError(410, "EXPIRED", "This itinerary's time window has passed — ask Toura for a new plan");

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const me = getAddress(wallet.address);

  if (enabled) {
    if (it.partySize < 2) throw new ApiError(400, "BAD_REQUEST", "A group trip needs at least 2 people");
    if (!it.stops.some((s) => s.payMode === "ESCROW" && s.status === "PENDING")) {
      throw new ApiError(400, "BAD_REQUEST", "Nothing to prepay on this trip");
    }
    if (it.groupMode && it.organizerAddress && getAddress(it.organizerAddress) !== me) {
      throw new ApiError(403, "FORBIDDEN", "Only the organizer can change this");
    }
    await prisma.itinerary.update({ where: { id: it.id }, data: { groupMode: true, organizerAddress: me } });
  } else {
    if (it.organizerAddress && getAddress(it.organizerAddress) !== me) throw new ApiError(403, "FORBIDDEN", "Only the organizer can change this");
    if (it.shares.some((s) => s.status !== "PENDING")) throw new ApiError(409, "CONFLICT", "Someone has already paid their share");
    await prisma.$transaction([
      prisma.groupShare.deleteMany({ where: { itineraryId: it.id } }),
      prisma.itinerary.update({ where: { id: it.id }, data: { groupMode: false, organizerAddress: null } }),
    ]);
  }
  return NextResponse.json({ itinerary: await getItineraryView(it.id) });
});
