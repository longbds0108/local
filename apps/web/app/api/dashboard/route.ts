import { after, NextResponse } from "next/server";
import { formatUnits, getAddress, type Address } from "viem";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { itineraryInclude, toView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";
import { isOverdue, sweepItinerary } from "@/lib/refunds";
import { emptyDashboard, type DashboardActivity, type DashboardData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  /** Draft itineraries this browser is planning (from the chat), shown as "planning". */
  draftIds: z.array(z.string().min(1).max(64)).max(5).default([]),
});

const include = itineraryInclude;

/**
 * The traveller's dashboard. Ownership is proven with the Circle user token:
 * the wallet address comes from Circle, never from the client.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`dashboard:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, draftIds } = await parseJson(req, Body);

  const wallet = await getArcWallet(userToken);
  // Signed in but the wallet isn't created yet (e.g. the PIN window was closed): same shape, empty.
  if (!wallet) return NextResponse.json(emptyDashboard(config.explorerUrl ?? null, config.faucetUrl ?? null));
  const address = getAddress(wallet.address);

  const [paid, drafts, balance] = await Promise.all([
    prisma.itinerary.findMany({
      // Trips this wallet started, and group trips it paid a share of.
      where: { OR: [{ payerAddress: address }, { shares: { some: { payerAddress: address, status: { not: "PENDING" } } } }] },
      include,
      orderBy: { startAt: "desc" },
      take: 50,
    }),
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
    if (it.groupMode) {
      // Group trip: this wallet's own share of the prepaid stops…
      const mine = it.shares.find((s) => getAddress(s.payerAddress) === address && s.status !== "PENDING");
      if (mine) {
        const usdcOf = (wei: string) => Number(formatUnits(BigInt(wei), 18));
        const total = mine.stops.reduce((sum, p) => sum + usdcOf(p.amountWei), 0);
        activity.push({ type: "deposit", itineraryId: it.id, title: it.title, amountUsdc: total.toFixed(2), txHash: mine.depositTx, at: (mine.paidAt ?? it.updatedAt).toISOString() });
        for (const p of mine.stops) {
          const s = it.stops.find((x) => x.id === p.stopId);
          const amount = usdcOf(p.amountWei);
          if (p.status === "RELEASED") {
            released += amount;
            activity.push({ type: "release", itineraryId: it.id, title: s?.name ?? it.title, merchant: s?.merchant?.name ?? null, merchantId: s?.merchant?.id ?? null, amountUsdc: amount.toFixed(2), txHash: p.releaseTx, at: (p.releasedAt ?? it.updatedAt).toISOString() });
          } else if (p.status === "REFUNDED") {
            refunded += amount;
            activity.push({ type: "refund", itineraryId: it.id, title: s?.name ?? it.title, amountUsdc: amount.toFixed(2), txHash: p.refundTx, at: (p.refundedAt ?? it.updatedAt).toISOString() });
          } else {
            escrowed += amount;
            if (p.status === "PENDING" && it.status === "PAID" && (it.deadline ?? 0) > now) activeVouchers += 1;
          }
        }
      }
      // …and, for the organizer, the bills paid at the venue.
      if (it.payerAddress && getAddress(it.payerAddress) === address) {
        for (const s of it.stops.filter((x) => x.payMode === "VENUE")) {
          if (s.status === "RELEASED") {
            const amount = Number((s.paidUsdc ?? s.priceUsdc).toString());
            released += amount;
            activity.push({ type: "venue", itineraryId: it.id, title: s.name, merchant: s.merchant?.name ?? null, merchantId: s.merchant?.id ?? null, amountUsdc: amount.toFixed(2), txHash: s.releaseTx, at: (s.checkedInAt ?? it.updatedAt).toISOString() });
          } else if (s.status === "PENDING" && it.status === "PAID" && (it.deadline ?? 0) > now) activeVouchers += 1;
        }
      }
      continue;
    }
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
  const overdue = views.filter(isOverdue);
  if (overdue.length) after(async () => {
    for (const v of overdue) await sweepItinerary(v.id);
  });
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
