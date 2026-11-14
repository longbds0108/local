import { NextResponse } from "next/server";
import { type Address } from "viem";
import { z } from "zod";
import { ApiError, handle, parseQuery } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { PARTNER_POOL_MERCHANT_ID } from "@/lib/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ id: z.string().min(1).max(64).optional() });

/** GET /api/merchant → list; GET /api/merchant?id= → wallet balance + released vouchers. */
export const GET = handle(async (req: Request) => {
  const { id } = parseQuery(req, Query);
  if (!id) {
    // The old shared "partner pool" wallet isn't a venue: keep it out of the list (old trips can still look it up by id).
    const merchants = await prisma.merchant.findMany({ where: { id: { not: PARTNER_POOL_MERCHANT_ID } }, orderBy: { name: "asc" } });
    return NextResponse.json({ merchants });
  }
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new ApiError(404, "NOT_FOUND", "Merchant not found");

  const released = await prisma.stop.findMany({
    where: { merchantId: id, status: "RELEASED" },
    orderBy: { checkedInAt: "desc" },
    take: 50,
    select: { id: true, name: true, priceUsdc: true, paidUsdc: true, payMode: true, releaseTx: true, checkedInAt: true },
  });
  let balance: string | null = null;
  try {
    balance = await nativeUsdcBalance(merchant.walletAddress as Address);
  } catch {
    balance = null; // chain not configured / RPC down — page still works
  }
  // Pay-at-venue stops record what was actually paid; prepaid stops pay their fixed price.
  const amountOf = (r: (typeof released)[number]) => (r.paidUsdc ?? r.priceUsdc).toString();
  const revenue = released.reduce((s, r) => s + Number(amountOf(r)), 0);
  return NextResponse.json({
    merchant,
    balance,
    revenueUsdc: revenue.toFixed(2),
    explorerUrl: config.explorerUrl ?? null,
    released: released.map((r) => ({ id: r.id, name: r.name, releaseTx: r.releaseTx, checkedInAt: r.checkedInAt, priceUsdc: amountOf(r) })),
  });
});
