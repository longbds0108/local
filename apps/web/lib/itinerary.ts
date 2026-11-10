import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { ItineraryStatus, ItineraryView, StopStatus, StopView } from "./types";

const include = { stops: { include: { merchant: true }, orderBy: { order: "asc" } } } as const;
type ItineraryWithStops = Prisma.ItineraryGetPayload<{ include: typeof include }>;

export function toView(it: ItineraryWithStops): ItineraryView {
  return {
    id: it.id,
    title: it.title,
    startAt: it.startAt.toISOString(),
    endAt: it.endAt.toISOString(),
    partySize: it.partySize,
    totalUsdc: it.totalUsdc.toString(),
    status: it.status as ItineraryStatus,
    depositTxHash: it.depositTxHash,
    onchainId: it.onchainId,
    deadline: it.deadline,
    payerAddress: it.payerAddress,
    profile: it.profile,
    geometry: it.geometry ? JSON.parse(it.geometry) : null,
    stops: it.stops.map(
      (s): StopView => ({
        id: s.id,
        order: s.order,
        osmId: s.osmId,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        category: s.category,
        arriveAt: s.arriveAt.toISOString(),
        durationMin: s.durationMin,
        travelMin: s.travelMin,
        priceUsdc: s.priceUsdc.toString(),
        priceSource: s.priceSource as "seed" | "estimate",
        note: s.note,
        status: s.status as StopStatus,
        onchainIndex: s.onchainIndex,
        releaseTx: s.releaseTx,
        refundTx: s.refundTx,
        // qrSecret is never exposed through the view.
        merchant: s.merchant ? { id: s.merchant.id, name: s.merchant.name, walletAddress: s.merchant.walletAddress } : null,
      }),
    ),
  };
}

export async function getItineraryView(id: string): Promise<ItineraryView | null> {
  const it = await prisma.itinerary.findUnique({ where: { id }, include });
  return it ? toView(it) : null;
}

export async function getItineraryWithStops(id: string) {
  return prisma.itinerary.findUnique({ where: { id }, include });
}

/**
 * Derive the itinerary status from its paid stops once it has been paid:
 * all released → COMPLETED, all refunded → REFUNDED, all settled but mixed → PARTIAL.
 */
export async function recomputeItineraryStatus(itineraryId: string): Promise<ItineraryStatus> {
  const it = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId }, include: { stops: true } });
  if (it.status === "DRAFT") return "DRAFT";
  const paid = it.stops.filter((s) => s.status !== "FREE");
  const released = paid.filter((s) => s.status === "RELEASED").length;
  const refunded = paid.filter((s) => s.status === "REFUNDED").length;
  let status: ItineraryStatus = "PAID";
  if (paid.length > 0 && released + refunded === paid.length) {
    status = released === paid.length ? "COMPLETED" : refunded === paid.length ? "REFUNDED" : "PARTIAL";
  }
  if (status !== it.status) await prisma.itinerary.update({ where: { id: itineraryId }, data: { status } });
  return status;
}
