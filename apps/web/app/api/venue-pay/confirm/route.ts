import { NextResponse } from "next/server";
import { formatUnits, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { findUsdcTransfer } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { getItineraryView, recomputeItineraryStatus } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ stopId: z.string().min(1).max(64) });

/**
 * Marks a pay-at-venue stop as paid once the chain shows a USDC transfer from the
 * trip's wallet to that venue's wallet (after the payment was started). The client
 * only says "check now"; the amount and tx come from the Transfer event.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`venue-confirm:${clientIp(req)}`, 90, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { stopId } = await parseJson(req, Body);
  const stop = await prisma.stop.findUnique({ where: { id: stopId }, include: { itinerary: true, merchant: true } });
  if (!stop || stop.payMode !== "VENUE" || !stop.merchant) throw new ApiError(404, "NOT_FOUND", "Stop not found");

  const done = () => ({
    paid: true,
    amountUsdc: stop.paidUsdc?.toString() ?? null,
    explorerTxUrl: config.explorerUrl && stop.releaseTx ? `${config.explorerUrl}/tx/${stop.releaseTx}` : null,
  });
  if (stop.status === "RELEASED") return NextResponse.json({ ...done(), itinerary: await getItineraryView(stop.itineraryId) });
  if (stop.status !== "PENDING" || stop.payFromBlock === null || !stop.itinerary.payerAddress) return NextResponse.json({ paid: false });

  // A transfer already credited to another stop can't count twice.
  const used = await prisma.stop.findMany({ where: { payMode: "VENUE", releaseTx: { not: null } }, select: { releaseTx: true } });
  // Who may have paid the bill: the trip's payer, and on a group trip any member who paid a share.
  const members = stop.itinerary.groupMode
    ? (await prisma.groupShare.findMany({ where: { itineraryId: stop.itineraryId, status: { not: "PENDING" } }, select: { payerAddress: true } })).map((m) => m.payerAddress)
    : [];
  const payers = [...new Set([stop.itinerary.payerAddress, ...members].map((a) => a.toLowerCase()))];
  const exclude = new Set(used.map((u) => u.releaseTx!.toLowerCase()));
  let hit: Awaited<ReturnType<typeof findUsdcTransfer>> = null;
  for (const from of payers) {
    hit = await findUsdcTransfer(from as Address, stop.merchant.walletAddress as Address, BigInt(stop.payFromBlock), exclude);
    if (hit) break;
  }
  if (!hit) return NextResponse.json({ paid: false });

  const amount = formatUnits(hit.value, hit.decimals);
  const updated = await prisma.stop.updateMany({
    where: { id: stop.id, status: "PENDING" },
    data: { status: "RELEASED", releaseTx: hit.txHash, paidUsdc: amount, checkedInAt: new Date() },
  });
  if (updated.count === 1) await recomputeItineraryStatus(stop.itineraryId);
  const fresh = await prisma.stop.findUniqueOrThrow({ where: { id: stop.id } });
  return NextResponse.json({
    paid: true,
    amountUsdc: fresh.paidUsdc?.toString() ?? amount,
    explorerTxUrl: config.explorerUrl && fresh.releaseTx ? `${config.explorerUrl}/tx/${fresh.releaseTx}` : null,
    itinerary: await getItineraryView(stop.itineraryId),
  });
});
