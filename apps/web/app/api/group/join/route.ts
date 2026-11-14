import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { seatsTaken } from "@/lib/group";
import { getItineraryView, getItineraryWithStops } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  itineraryId: z.string().min(1).max(64),
  /** Seats this member covers (themselves, or friends too). */
  people: z.number().int().min(1).max(20),
});

/**
 * Join a group trip that is paid only at venues (nothing to prepay): the member then
 * splits each venue's bill with the others. On a trip with prepaid stops, members join
 * by paying their share instead (/api/group/pay). Joining again changes the seats.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-join:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId, people } = await parseJson(req, Body);
  const it = await getItineraryWithStops(itineraryId);
  if (!it || !it.groupMode) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT" && it.status !== "PAID") throw new ApiError(409, "CONFLICT", "This trip is over");
  if (it.endAt.getTime() <= Date.now()) throw new ApiError(410, "EXPIRED", "This trip is over");
  if (it.stops.some((s) => s.payMode === "ESCROW" && s.status === "PENDING")) {
    throw new ApiError(409, "CONFLICT", "This trip has a prepaid part — pay your share to join");
  }

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const me = getAddress(wallet.address);

  const mine = it.shares.find((s) => getAddress(s.payerAddress) === me);
  if (mine && mine.status !== "JOINED") throw new ApiError(409, "CONFLICT", "You've already paid your share");
  const free = it.partySize - (await seatsTaken(itineraryId, me)) + (mine?.people ?? 0);
  if (free <= 0) throw new ApiError(409, "CONFLICT", "Everyone has already joined");
  if (people > free) throw new ApiError(409, "CONFLICT", "Not enough seats left", { free });

  await prisma.groupShare.upsert({
    where: { itineraryId_payerAddress: { itineraryId, payerAddress: me } },
    create: { itineraryId, payerAddress: me, people, status: "JOINED" },
    update: { people },
  });
  return NextResponse.json({ itinerary: await getItineraryView(itineraryId) });
});
