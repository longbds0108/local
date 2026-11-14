// Group trips: the prepaid part is split per person, and each member deposits their
// own share into the escrow (own on-chain id, own check-in codes). At the venue each
// member's code releases their share to the venue; a share nobody uses is refunded
// to the wallet that paid it. The escrow contract is unchanged: a share is just one
// deposit() whose amounts are that member's part of each prepaid stop.
import { formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";
import { ApiError } from "./api";
import { findDepositTx, findUsdcTransfer, operatorRefund, readEscrowItinerary } from "./chain";
import { prisma } from "./db";
import { recomputeItineraryStatus } from "./itinerary";
import { toNativeUnits } from "./pricing";

/** An unconfirmed share holds its seats this long (time to finish the PIN step). */
export const SEAT_HOLD_MS = 15 * 60_000;

/** Native units (18 decimals) one person owes for a prepaid stop. */
export function perPersonWei(priceUsdc: string, partySize: number): bigint {
  return toNativeUnits(priceUsdc) / BigInt(Math.max(1, partySize));
}

/** Seats already paid, or held by someone else's unconfirmed share. */
export async function seatsTaken(itineraryId: string, exceptPayer?: string): Promise<number> {
  const shares = await prisma.groupShare.findMany({ where: { itineraryId } });
  const holdFrom = Date.now() - SEAT_HOLD_MS;
  return shares
    .filter((s) => s.status !== "PENDING" || (s.payerAddress !== exceptPayer && s.updatedAt.getTime() > holdFrom))
    .reduce((n, s) => n + s.people, 0);
}

/**
 * Check every unconfirmed share against the chain: a share becomes PAID only when
 * its on-chain deposit matches the venues, amounts and code hashes we stored, and
 * comes from the wallet that asked for it. The first paid share starts the trip.
 */
export async function confirmShares(itineraryId: string): Promise<number> {
  const it = await prisma.itinerary.findUnique({
    where: { id: itineraryId },
    include: { shares: { where: { status: "PENDING", onchainId: { not: null } }, include: { stops: { include: { stop: { include: { merchant: true } } } } } } },
  });
  if (!it) return 0;
  let confirmed = 0;
  for (const share of it.shares) {
    const onchain = await readEscrowItinerary(share.onchainId as Hex).catch(() => null);
    if (!onchain || /^0x0{40}$/i.test(onchain.payer)) continue;
    const mine = [...share.stops].sort((a, b) => a.onchainIndex - b.onchainIndex);
    const matches =
      getAddress(onchain.payer) === getAddress(share.payerAddress) &&
      onchain.stops.length === mine.length &&
      mine.every((ss, i) => {
        const o = onchain.stops[i];
        return (
          !!ss.stop.merchant &&
          getAddress(o.merchant) === getAddress(ss.stop.merchant.walletAddress) &&
          o.amount === BigInt(ss.amountWei) &&
          o.codeHash.toLowerCase() === ss.codeHash.toLowerCase()
        );
      });
    if (!matches) {
      console.warn("[group] on-chain deposit does not match share", share.id);
      continue;
    }
    const depositTx = await findDepositTx(share.onchainId as Hex).catch(() => null);
    await prisma.groupShare.update({ where: { id: share.id }, data: { status: "PAID", paidAt: new Date(), depositTx } });
    confirmed++;
  }
  if (confirmed > 0 && it.status === "DRAFT") {
    // The trip is on: its plan can't change any more, and the organizer pays the at-venue bills.
    await prisma.itinerary.update({
      where: { id: it.id },
      data: { status: "PAID", paidAt: new Date(), payerAddress: it.organizerAddress ?? it.payerAddress },
    });
  }
  return confirmed;
}

/**
 * A prepaid stop of a group trip is settled once every paid share's part of it is:
 * released if anyone's part reached the venue, otherwise refunded.
 */
export async function rollupGroupStop(stopId: string): Promise<void> {
  const stop = await prisma.stop.findUnique({
    where: { id: stopId },
    include: { shareStops: { include: { share: true } } },
  });
  if (!stop || stop.payMode !== "ESCROW") return;
  const parts = stop.shareStops.filter((ss) => ss.share.status !== "PENDING");
  if (parts.length === 0 || parts.some((ss) => ss.status !== "RELEASED" && ss.status !== "REFUNDED")) return;
  const status = parts.some((ss) => ss.status === "RELEASED") ? "RELEASED" : "REFUNDED";
  const last = parts.find((ss) => ss.status === status);
  await prisma.stop.update({
    where: { id: stopId },
    data: { status, releaseTx: status === "RELEASED" ? last?.releaseTx : null, refundTx: status === "REFUNDED" ? last?.refundTx : null },
  });
  await refreshShareStatus(parts.map((p) => p.shareId));
  await recomputeItineraryStatus(stop.itineraryId);
}

/** DONE when all of a share's parts reached venues, REFUNDED / PARTIAL otherwise once settled. */
async function refreshShareStatus(shareIds: string[]) {
  for (const id of new Set(shareIds)) {
    const share = await prisma.groupShare.findUnique({ where: { id }, include: { stops: true } });
    if (!share || share.status === "PENDING") continue;
    const settled = share.stops.every((s) => s.status === "RELEASED" || s.status === "REFUNDED");
    if (!settled) continue;
    const released = share.stops.filter((s) => s.status === "RELEASED").length;
    const status = released === share.stops.length ? "DONE" : released === 0 ? "REFUNDED" : "PARTIAL";
    if (status !== share.status) await prisma.groupShare.update({ where: { id }, data: { status } });
  }
}

/** Refund one member's part of a stop to that member (operator pays gas; the escrow only pays the payer). */
export async function refundShareStop(shareStopId: string): Promise<Hex> {
  const ss = await prisma.shareStop.findUnique({ where: { id: shareStopId }, include: { share: true } });
  if (!ss) throw new ApiError(404, "NOT_FOUND", "Stop not found");
  const locked = await prisma.shareStop.updateMany({ where: { id: ss.id, status: "PENDING" }, data: { status: "REFUNDING" } });
  if (locked.count !== 1) throw new ApiError(409, "CONFLICT", "Stop is not refundable (already used, refunded or in progress)");
  try {
    const txHash = await operatorRefund(ss.share.onchainId as Hex, ss.onchainIndex);
    await prisma.shareStop.update({ where: { id: ss.id }, data: { status: "REFUNDED", refundTx: txHash, refundedAt: new Date() } });
    await rollupGroupStop(ss.stopId);
    return txHash;
  } catch (err) {
    await prisma.shareStop.update({ where: { id: ss.id }, data: { status: "PENDING" } });
    throw new ApiError(502, "CHAIN_ERROR", `On-chain refund failed: ${(err as Error).message.split("\n")[0]}`);
  }
}

/** Members of a group trip: everyone who joined or paid a share (not unconfirmed deposits). */
export async function groupMembers(itineraryId: string) {
  return prisma.groupShare.findMany({ where: { itineraryId, status: { not: "PENDING" } }, orderBy: { createdAt: "asc" } });
}

/** Transfers already credited to a venue stop or a bill part can't count twice. */
async function usedTransfers(): Promise<Set<string>> {
  const [stops, parts] = await Promise.all([
    prisma.stop.findMany({ where: { payMode: "VENUE", releaseTx: { not: null } }, select: { releaseTx: true } }),
    prisma.venueBillPart.findMany({ where: { txHash: { not: null } }, select: { txHash: true } }),
  ]);
  return new Set([...stops.map((s) => s.releaseTx!.toLowerCase()), ...parts.map((p) => p.txHash!.toLowerCase())]);
}

/**
 * Look on-chain for each member's transfer of their part of a venue bill (exact amount,
 * from that member to the venue). The stop is paid once every part is.
 */
export async function confirmBillParts(stopId: string): Promise<void> {
  const bill = await prisma.venueBill.findUnique({ where: { stopId }, include: { parts: true, stop: { include: { merchant: true } } } });
  if (!bill || !bill.stop.merchant) return;
  const used = await usedTransfers();
  for (const part of bill.parts.filter((p) => p.status === "PENDING" && p.fromBlock !== null)) {
    const hit = await findUsdcTransfer(
      part.payerAddress as Address,
      bill.stop.merchant.walletAddress as Address,
      BigInt(part.fromBlock!),
      used,
      parseUnits(part.amountUsdc, 6),
    ).catch(() => null);
    if (!hit) continue;
    used.add(hit.txHash.toLowerCase());
    await prisma.venueBillPart.updateMany({ where: { id: part.id, status: "PENDING" }, data: { status: "PAID", txHash: hit.txHash, paidAt: new Date() } });
  }
  await settleBill(stopId, false);
}

/**
 * Mark a venue stop paid from its bill: when every part is paid, or — once the trip is
 * over (`final`) — with whatever was paid. A bill nobody paid leaves the stop to be skipped.
 */
export async function settleBill(stopId: string, final: boolean): Promise<void> {
  const bill = await prisma.venueBill.findUnique({ where: { stopId }, include: { parts: true } });
  if (!bill) return;
  const paid = bill.parts.filter((p) => p.status === "PAID");
  if (paid.length === 0 || (!final && paid.length < bill.parts.length)) return;
  const total = paid.reduce((sum, p) => sum + parseUnits(p.amountUsdc, 6), 0n);
  const last = [...paid].sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0)).pop()!;
  const updated = await prisma.stop.updateMany({
    where: { id: stopId, status: "PENDING" },
    data: { status: "RELEASED", paidUsdc: formatUnits(total, 6), releaseTx: last.txHash, checkedInAt: last.paidAt ?? new Date() },
  });
  if (updated.count === 1) {
    const stop = await prisma.stop.findUniqueOrThrow({ where: { id: stopId } });
    await recomputeItineraryStatus(stop.itineraryId);
  }
}

/** Trip over: venue stops with a partly paid bill count as paid (with what was paid). */
export async function closeBills(itineraryId: string): Promise<void> {
  const bills = await prisma.venueBill.findMany({ where: { stop: { itineraryId, status: "PENDING" } }, select: { stopId: true } });
  for (const b of bills) {
    await confirmBillParts(b.stopId).catch(() => {});
    await settleBill(b.stopId, true);
  }
}

/** After the deadline: refund every member's unused part. */
export async function sweepGroup(itineraryId: string): Promise<void> {
  const parts = await prisma.shareStop.findMany({
    where: { status: "PENDING", share: { itineraryId, status: "PAID" } },
    select: { id: true },
  });
  for (const p of parts) await refundShareStop(p.id).catch((err) => console.warn("[group sweep]", p.id, (err as Error).message));
}
