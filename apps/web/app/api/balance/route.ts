import { NextResponse } from "next/server";
import { isAddress, type Address } from "viem";
import { z } from "zod";
import { clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ address: z.string().refine((a) => isAddress(a), "invalid address") });

/** USDC balance on Arc (native balance, 18 decimals, shown as USDC). */
export const GET = handle(async (req: Request) => {
  if (!rateLimit(`balance:${clientIp(req)}`, 60, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { address } = parseQuery(req, Query);
  return NextResponse.json({ address, usdc: await nativeUsdcBalance(address as Address) });
});
