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

const Body = z.object({ userToken: z.string().min(10).max(4000), itineraryId: z.string().min(1).max(64) });

const GRACE_SEC = 2 * 3600; // same window as the escrow deadline (endAt + 2h)

/**
 * Starts a trip that has nothing to prepay (only pay-at-venue / pay-yourself stops).
 * No money moves: the trip is attached to the traveller's wallet so its venue
 * payments can be made and checked later. Trips with prepaid stops start by paying.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`start:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId } = await parseJson(req, Body);
  const it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT") return NextResponse.json({ started: true, itinerary: await getItineraryView(itineraryId) });
  if (it.stops.some((s) => s.payMode === "ESCROW" && s.status === "PENDING")) {
    throw new ApiError(409, "CONFLICT", "This trip has a prepaid part — pay it to start");
  }
  const deadline = Math.floor(it.endAt.getTime() / 1000) + GRACE_SEC;
  if (deadline <= Math.floor(Date.now() / 1000) + 60) {
    throw new ApiError(410, "EXPIRED", "This itinerary's time window has passed — ask Hedgora for a new plan");
  }
  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(400, "BAD_REQUEST", "No Arc wallet for this user yet");
  const payer = getAddress(wallet.address);
  const user = await prisma.user.findFirst({ where: { walletAddress: { in: [payer, payer.toLowerCase()] } } });

  await prisma.itinerary.updateMany({
    where: { id: it.id, status: "DRAFT" },
    data: { status: "PAID", paidAt: new Date(), payerAddress: payer, deadline, userId: user?.id ?? undefined },
  });
  return NextResponse.json({ started: true, itinerary: await getItineraryView(itineraryId) });
});
