import { NextResponse } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { usdcAllowance, usdcBalance } from "@/lib/chain";
import { getItineraryWithStops } from "@/lib/itinerary";
import { toBaseUnits } from "@/lib/pricing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  itineraryId: z.string().min(1).max(64),
  address: z.string().refine((a) => isAddress(a), "invalid address"),
});

/** Read-only: does this wallet have enough USDC and allowance to pay the itinerary? */
export const GET = handle(async (req: Request) => {
  if (!rateLimit(`pay-status:${clientIp(req)}`, 120, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { itineraryId, address } = parseQuery(req, Query);
  const it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  const total = it.stops.filter((s) => s.status !== "FREE").reduce((sum, s) => sum + toBaseUnits(s.priceUsdc.toString()), 0n);
  const [balance, allowance] = await Promise.all([usdcBalance(address as Address), usdcAllowance(address as Address)]);
  return NextResponse.json({
    total: formatUnits(total, 6),
    balance: formatUnits(balance, 6),
    allowance: formatUnits(allowance, 6),
    balanceOk: balance >= total,
    allowanceOk: allowance >= total,
  });
});
