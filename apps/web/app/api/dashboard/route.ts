import { NextResponse } from "next/server";
import { getAddress, type Address } from "viem";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { toView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";
import { isOverdue, sweepItinerary } from "@/lib/refunds";
import type { DashboardActivity, DashboardData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  /** Draft itineraries this browser is planning (from the chat), shown as "planning". */
  draftIds: z.array(z.string().min(1).max(64)).max(5).default([]),
});

const include = { stops: { include: { merchant: true }, orderBy: { order: "asc" } } } as const;

/**
 * The traveller's dashboard. Ownership is proven with the Circle user token:
 * the wallet address comes from Circle, never from the client.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`dashboard:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, draftIds } = await parseJson(req, Body);

  const wallet = await getArcWallet(userToken);
  if (!wallet) return NextResponse.json({ wallet: null } satisfies Partial<DashboardData>);
  const address = getAddress(wallet.address);

  const [paid, drafts, balance] = await Promise.all([
    prisma.itinerary.findMany({ where: { payerAddress: address }, include, orderBy: { startAt: "desc" }, take: 50 }),
    draftIds.length
      ? prisma.itinerary.findMany({ where: { id: { in: draftIds }, status: "DRAFT" }, include, orderBy: { updatedAt: "desc" } })
      : Promise.resolve([]),
    nativeUsdcBalance(address as Address).catch(() => null),
  ]);

  let escrowed = 0;
  let released = 0;
  let refunded = 0;
  let activeVouchers = 0;
  const now = Date.now() / 1000;
  const activity: DashboardActivity[] = [];

  for (const it of paid) {
    const escrowStops = it.stops.filter((s) => s.status !== "FREE" && s.payMode === "ESCROW");
    const deposit = escrowStops.reduce((sum, s) => sum + Number(s.priceUsdc), 0);
    if (it.depositTxHash || (it.paidAt && deposit > 0)) {
      activity.push({ type: "deposit", itineraryId: it.id, title: it.title, amountUsdc: deposit.toFixed(2), txHash: it.depositTxHash, at: (it.paidAt ?? it.updatedAt).toISOString() });
    }
    for (const s of it.stops) {
      if (s.payMode === "VENUE") {
        // Paid straight to the venue on arrival — never held by the escrow.
        if (s.status === "RELEASED") {
          const amount = Number((s.paidUsdc ?? s.priceUsdc).toString());
          released += amount;
          activity.push({ type: "venue", itineraryId: it.id, title: s.name, merchant: s.merchant?.name ?? null, merchantId: s.merchant?.id ?? null, amountUsdc: amount.toFixed(2), txHash: s.releaseTx, at: (s.checkedInAt ?? it.updatedAt).toISOString() });
        } else if (s.status === "PENDING" && it.status === "PAID" && (it.deadline ?? 0) > now) activeVouchers += 1;
        continue;
      }
      if (s.status === "FREE" || s.payMode !== "ESCROW") continue;
      const amount = Number(s.priceUsdc);
      if (s.status === "RELEASED") {
        released += amount;
        activity.push({ type: "release", itineraryId: it.id, title: s.name, merchant: s.merchant?.name ?? null, merchantId: s.merchant?.id ?? null, amountUsdc: amount.toFixed(2), txHash: s.releaseTx, at: (s.checkedInAt ?? it.updatedAt).toISOString() });
      } else if (s.status === "REFUNDED") {
        refunded += amount;
        activity.push({ type: "refund", itineraryId: it.id, title: s.name, amountUsdc: amount.toFixed(2), txHash: s.refundTx, at: (s.refundedAt ?? it.updatedAt).toISOString() });
      } else {
        escrowed += amount;
        if (s.status === "PENDING" && it.status === "PAID" && (it.deadline ?? 0) > now) activeVouchers += 1;
      }
    }
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));

  const views = paid.map(toView);
  for (const v of views) if (isOverdue(v)) void sweepItinerary(v.id);
  const data: DashboardData = {
    wallet: { id: wallet.id, address },
    balanceUsdc: balance,
    explorerUrl: config.explorerUrl ?? null,
    faucetUrl: config.faucetUrl ?? null,
    stats: {
      escrowedUsdc: escrowed.toFixed(2),
      releasedUsdc: released.toFixed(2),
      refundedUsdc: refunded.toFixed(2),
      trips: paid.length,
      activeVouchers,
    },
    drafts: drafts.map(toView),
    active: views.filter((v) => v.status === "PAID"),
    history: views.filter((v) => v.status !== "PAID"),
    activity: activity.slice(0, 30),
  };
  return NextResponse.json(data);
});
