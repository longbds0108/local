// Refunds: only ever to the payer (the escrow enforces it). Used for traveller
// cancellations, the cron sweep, and the lazy sweep when an overdue trip is viewed.
import type { Hex } from "viem";
import { ApiError } from "./api";
import { operatorRefund } from "./chain";
import { prisma } from "./db";
import { config } from "./env";
import { sweepGroup } from "./group";
import { recomputeItineraryStatus } from "./itinerary";

export async function refundStop(stop: { id: string; itineraryId: string; onchainIndex: number | null }, onchainId: string) {
  if (stop.onchainIndex === null) throw new ApiError(409, "CONFLICT", "Stop is not escrowed on-chain");
  const locked = await prisma.stop.updateMany({ where: { id: stop.id, status: "PENDING" }, data: { status: "REFUNDING" } });
  if (locked.count !== 1) throw new ApiError(409, "CONFLICT", "Stop is not refundable (already used, refunded or in progress)");
  try {
    const txHash = await operatorRefund(onchainId as Hex, stop.onchainIndex);
    await prisma.stop.update({ where: { id: stop.id }, data: { status: "REFUNDED", refundTx: txHash, refundedAt: new Date() } });
    await recomputeItineraryStatus(stop.itineraryId);
    return txHash;
  } catch (err) {
    await prisma.stop.update({ where: { id: stop.id }, data: { status: "PENDING" } });
    throw new ApiError(502, "CHAIN_ERROR", `On-chain refund failed: ${(err as Error).message.split("\n")[0]}`);
  }
}

const running = new Set<string>();

/**
 * Refund every unused stop of a paid itinerary whose deadline has passed.
 * Fire-and-forget from read paths, so overdue money goes back as soon as the
 * trip (or the traveller's trip list) is opened — no cron needed for the demo.
 */
export async function sweepItinerary(itineraryId: string): Promise<void> {
  if (running.has(itineraryId)) return;
  running.add(itineraryId);
  try {
    const it = await prisma.itinerary.findUnique({ where: { id: itineraryId }, include: { stops: true } });
    if (!it || it.status !== "PAID" || !it.deadline || it.deadline > Date.now() / 1000) return;
    // Pay-at-venue stops that were never paid: no money was held, so nothing to refund.
    await prisma.stop.updateMany({ where: { itineraryId, payMode: "VENUE", status: "PENDING" }, data: { status: "SKIPPED" } });
    // Group trip: refund each member's unused part to that member.
    if (it.groupMode && config.paymentsConfigured && process.env.OPERATOR_PRIVATE_KEY) await sweepGroup(itineraryId);
    // Prepaid stops: refund to the payer (needs the operator key to send the tx).
    if (!it.groupMode && it.onchainId && config.paymentsConfigured && process.env.OPERATOR_PRIVATE_KEY) {
      for (const s of it.stops.filter((x) => x.status === "PENDING" && x.onchainIndex !== null)) {
        await refundStop(s, it.onchainId).catch((err) => console.warn("[sweep]", s.id, (err as Error).message));
      }
    }
    const status = await recomputeItineraryStatus(itineraryId);
    // Nothing paid in the app at all (only pay-yourself stops): the trip is simply over.
    if (status === "PAID" && !it.stops.some((s) => s.status !== "FREE")) {
      await prisma.itinerary.update({ where: { id: itineraryId }, data: { status: "COMPLETED" } });
    }
  } finally {
    running.delete(itineraryId);
  }
}

/** True when a started trip has passed its deadline: unused money goes back, the trip closes. */
export function isOverdue(it: { status: string; deadline: number | null }): boolean {
  return it.status === "PAID" && !!it.deadline && it.deadline <= Date.now() / 1000;
}
