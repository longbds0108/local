import { NextResponse } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { z } from "zod";
import { clientIp, handle, jsonError, parseQuery } from "@/lib/api";
import { findUsdcTransfer } from "@/lib/chain";
import { config } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  from: z.string().refine((a) => isAddress(a), "invalid address"),
  to: z.string().refine((a) => isAddress(a), "invalid address"),
  fromBlock: z.string().regex(/^\d{1,20}$/),
});

/** Read-only (public chain data): has a USDC transfer from → to landed since fromBlock? */
export const GET = handle(async (req: Request) => {
  if (!rateLimit(`wallet-transfer:${clientIp(req)}`, 120, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const q = parseQuery(req, Query);
  const hit = await findUsdcTransfer(q.from as Address, q.to as Address, BigInt(q.fromBlock), new Set());
  if (!hit) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    txHash: hit.txHash,
    amountUsdc: formatUnits(hit.value, hit.decimals),
    explorerTxUrl: config.explorerUrl ? `${config.explorerUrl}/tx/${hit.txHash}` : null,
  });
});
