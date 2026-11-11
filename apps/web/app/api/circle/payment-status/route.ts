import { NextResponse } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { nativeUsdcWei } from "@/lib/chain";
import { getItineraryWithStops } from "@/lib/itinerary";
import { toNativeUnits } from "@/lib/pricing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  itineraryId: z.string().min(1).max(64),
  address: z.string().refine((a) => isAddress(a), "invalid address"),
});

/** Read-only: does this wallet hold enough native USDC for the trip's prepaid part? */
export const GET = handle(async (req: Request) => {
  if (!rateLimit(`pay-status:${clientIp(req)}`, 120, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { itineraryId, address } = parseQuery(req, Query);
  const it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  const total = it.stops.filter((s) => s.status !== "FREE" && s.payMode === "ESCROW").reduce((sum, s) => sum + toNativeUnits(s.priceUsdc.toString()), 0n);
  const balance = await nativeUsdcWei(address as Address);
  return NextResponse.json({ total: formatUnits(total, 18), balance: formatUnits(balance, 18), balanceOk: balance >= total });
});
