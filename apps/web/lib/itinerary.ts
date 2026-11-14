import type { Prisma } from "@prisma/client";
import { formatUnits } from "viem";
import { prisma } from "./db";
import { toNativeUnits } from "./pricing";
import type { GroupShareStatus, GroupView, ItineraryStatus, ItineraryView, PayMode, StopStatus, StopView } from "./types";

export const itineraryInclude = {
  stops: { include: { merchant: true }, orderBy: { order: "asc" } },
  shares: { include: { stops: true }, orderBy: { createdAt: "asc" } },
} as const;
const include = itineraryInclude;
type ItineraryWithStops = Prisma.ItineraryGetPayload<{ include: typeof include }>;

function groupView(it: ItineraryWithStops): GroupView | null {
  if (!it.groupMode) return null;
  const n = BigInt(Math.max(1, it.partySize));
  const perPerson = it.stops
    .filter((s) => s.payMode === "ESCROW" && s.status !== "FREE")
    .reduce((sum, s) => sum + toNativeUnits(s.priceUsdc.toString()) / n, 0n);
  return {
    organizerAddress: it.organizerAddress,
    perPersonUsdc: formatUnits(perPerson, 18),
    paidPeople: it.shares.filter((s) => s.status !== "PENDING").reduce((sum, s) => sum + s.people, 0),
    shares: it.shares.map((s) => ({
      id: s.id,
      payerAddress: s.payerAddress,
      people: s.people,
      status: s.status as GroupShareStatus,
      paidAt: s.paidAt?.toISOString() ?? null,
      depositTx: s.depositTx,
      stops: s.stops.map((ss) => ({
        stopId: ss.stopId,
        amountUsdc: formatUnits(BigInt(ss.amountWei), 18),
        status: ss.status,
        releaseTx: ss.releaseTx,
        refundTx: ss.refundTx,
      })),
    })),
  };
}

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
        payMode: s.payMode as PayMode,
        paidUsdc: s.paidUsdc?.toString() ?? null,
        payStarted: s.payFromBlock !== null,
        onchainIndex: s.onchainIndex,
        releaseTx: s.releaseTx,
        refundTx: s.refundTx,
        // qrSecret is never exposed through the view.
        merchant: s.merchant ? { id: s.merchant.id, name: s.merchant.name, walletAddress: s.merchant.walletAddress } : null,
      }),
    ),
    group: groupView(it),
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
 * Derive the itinerary status from its in-app stops (prepaid + pay-at-venue) once started:
 * nothing refunded → COMPLETED, refunds but nothing paid → REFUNDED, otherwise PARTIAL.
 * A pay-at-venue stop that was never paid (SKIPPED) moved no money.
 */
export async function recomputeItineraryStatus(itineraryId: string): Promise<ItineraryStatus> {
  const it = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId }, include: { stops: true } });
  if (it.status === "DRAFT") return "DRAFT";
  const paid = it.stops.filter((s) => s.status !== "FREE");
  const released = paid.filter((s) => s.status === "RELEASED").length;
  const refunded = paid.filter((s) => s.status === "REFUNDED").length;
  const skipped = paid.filter((s) => s.status === "SKIPPED").length;
  let status: ItineraryStatus = "PAID";
  if (paid.length > 0 && released + refunded + skipped === paid.length) {
    status = refunded === 0 ? "COMPLETED" : released === 0 ? "REFUNDED" : "PARTIAL";
  }
  if (status !== it.status) await prisma.itinerary.update({ where: { id: itineraryId }, data: { status } });
  return status;
}
