import { NextResponse } from "next/server";
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { addresses, nativeUsdcWei, onchainIdFor, readEscrowItinerary } from "@/lib/chain";
import { createContractExecutionChallenge, getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { confirmShares, perPersonWei, seatsTaken } from "@/lib/group";
import { getItineraryWithStops } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
const Body = z.object({
  userToken: z.string().min(10).max(4000),
  itineraryId: z.string().min(1).max(64),
  /** Seats this payment covers (yourself, or friends too). */
  people: z.number().int().min(1).max(20),
  /** stopId → keccak256(code). The codes stay on this member's device. */
  codeHashes: z.record(z.string().min(1).max(64), Hash),
});

const REFUND_GRACE_SEC = 2 * 3600;

/**
 * A member pays their share of a group trip: ONE Circle challenge for an escrow
 * deposit of `people` × the per-person part of every prepaid stop, under this
 * share's own on-chain id and with this member's own code hashes. Venues, amounts
 * and the deadline come from the DB; only the code hashes come from the client.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-pay:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId, people, codeHashes } = await parseJson(req, Body);
  const { escrow } = addresses();

  const it = await getItineraryWithStops(itineraryId);
  if (!it || !it.groupMode) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT" && it.status !== "PAID") throw new ApiError(409, "CONFLICT", "This trip is over");
  // Shares are collected until the trip starts.
  if (it.startAt.getTime() <= Date.now()) throw new ApiError(410, "EXPIRED", "The trip has started — shares can't be paid any more");
  const deadline = it.deadline ?? Math.floor(it.endAt.getTime() / 1000) + REFUND_GRACE_SEC;

  const prepaid = it.stops.filter((s) => s.payMode === "ESCROW" && s.status === "PENDING");
  if (prepaid.length === 0) throw new ApiError(400, "BAD_REQUEST", "Nothing to prepay on this trip");
  if (prepaid.some((s) => !s.merchant)) throw new ApiError(500, "INTERNAL", "A paid stop has no merchant wallet (run db:seed)");
  if (prepaid.some((s) => !codeHashes[s.id])) throw new ApiError(400, "BAD_REQUEST", "Invalid request");
  const hashes = prepaid.map((s) => codeHashes[s.id].toLowerCase());
  if (new Set(hashes).size !== hashes.length) throw new ApiError(400, "BAD_REQUEST", "Invalid request");

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const me = getAddress(wallet.address);

  let share = await prisma.groupShare.findUnique({ where: { itineraryId_payerAddress: { itineraryId, payerAddress: me } } });
  if (share && share.status !== "PENDING") throw new ApiError(409, "CONFLICT", "You've already paid your share");
  if (share) {
    // A previous attempt may have landed on-chain without being confirmed yet.
    const onchain = await readEscrowItinerary(share.onchainId as Hex).catch(() => null);
    if (onchain && !/^0x0{40}$/i.test(onchain.payer)) {
      await confirmShares(itineraryId);
      throw new ApiError(409, "CONFLICT", "You've already paid your share");
    }
  }

  const free = it.partySize - (await seatsTaken(itineraryId, me));
  if (free <= 0) throw new ApiError(409, "CONFLICT", "Everyone has already paid");
  if (people > free) throw new ApiError(409, "CONFLICT", "Not enough seats left", { free });

  // One on-chain id per member and trip, kept across retries: the escrow refuses a second
  // deposit under the same id, so a retried payment can never charge twice.
  const onchainId = share?.onchainId ?? onchainIdFor(`${it.id}:${me}`);
  const amounts = prepaid.map((s) => perPersonWei(s.priceUsdc.toString(), it.partySize) * BigInt(people));
  const total = amounts.reduce((a, b) => a + b, 0n);

  const balance = await nativeUsdcWei(me as Address);
  if (balance < total) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet", {
      balance: formatUnits(balance, 18),
      required: formatUnits(total, 18),
    });
  }

  const parts = prepaid.map((s, i) => ({ stopId: s.id, amountWei: amounts[i].toString(), onchainIndex: i, codeHash: hashes[i], status: "PENDING" }));
  share = await prisma.$transaction(async (tx) => {
    if (!it.deadline) await tx.itinerary.update({ where: { id: it.id }, data: { deadline } });
    if (share) {
      await tx.shareStop.deleteMany({ where: { shareId: share.id } });
      return tx.groupShare.update({ where: { id: share.id }, data: { people, stops: { create: parts } } });
    }
    return tx.groupShare.create({ data: { itineraryId, payerAddress: me, people, onchainId, status: "PENDING", stops: { create: parts } } });
  });

  const { challengeId } = await createContractExecutionChallenge({
    userToken,
    walletId: wallet.id,
    contractAddress: escrow,
    abiFunctionSignature: "deposit(bytes32,address[],uint256[],bytes32[],uint64)",
    abiParameters: [onchainId, prepaid.map((s) => s.merchant!.walletAddress), amounts.map((a) => a.toString()), hashes, String(deadline)],
    amount: formatUnits(total, 18),
    refId: `share:${share.id}`,
  });
  return NextResponse.json({ challengeId, total: formatUnits(total, 18), shareId: share.id });
});
