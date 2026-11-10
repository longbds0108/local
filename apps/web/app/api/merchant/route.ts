import { NextResponse } from "next/server";
import { formatUnits, type Address } from "viem";
import { z } from "zod";
import { ApiError, handle, parseQuery } from "@/lib/api";
import { usdcBalance } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ id: z.string().min(1).max(64).optional() });

/** GET /api/merchant → list; GET /api/merchant?id= → wallet balance + released vouchers. */
export const GET = handle(async (req: Request) => {
  const { id } = parseQuery(req, Query);
  if (!id) {
    const merchants = await prisma.merchant.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ merchants });
  }
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new ApiError(404, "NOT_FOUND", "Merchant not found");

  const released = await prisma.stop.findMany({
    where: { merchantId: id, status: "RELEASED" },
    orderBy: { checkedInAt: "desc" },
    take: 50,
    select: { id: true, name: true, priceUsdc: true, releaseTx: true, checkedInAt: true },
  });
  let balance: string | null = null;
  try {
    balance = formatUnits(await usdcBalance(merchant.walletAddress as Address), 6);
  } catch {
    balance = null; // chain not configured / RPC down — page still works
  }
  const revenue = released.reduce((s, r) => s + Number(r.priceUsdc), 0);
  return NextResponse.json({
    merchant,
    balance,
    revenueUsdc: revenue.toFixed(2),
    explorerUrl: config.explorerUrl ?? null,
    released: released.map((r) => ({ ...r, priceUsdc: r.priceUsdc.toString() })),
  });
});
