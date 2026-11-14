import { NextResponse } from "next/server";
import { formatUnits, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { addresses, nativeUsdcWei, onchainIdFor } from "@/lib/chain";
import { createContractExecutionChallenge, getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { getItineraryWithStops } from "@/lib/itinerary";
import { toNativeUnits } from "@/lib/pricing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Hash = z.string().regex(/^0x[0-9a-f]{64}$/i);
const Body = z.object({
  userToken: z.string().min(10).max(4000),
  itineraryId: z.string().min(1).max(64),
  /** stopId → keccak256(code). The codes stay on the traveller's device. */
  codeHashes: z.record(z.string().min(1).max(64), Hash),
});

const REFUND_GRACE_SEC = 2 * 3600; // deadline = endAt + 2h (spec §10)

/**
 * Creates ONE Circle contract-execution challenge: escrow.deposit(...) paid in
 * native USDC (msg.value), so there is no approve step. Amounts, merchants and
 * the deadline come from the DB — never from the client; only the code hashes do.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-pay:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId, codeHashes } = await parseJson(req, Body);
  const { escrow } = addresses();

  let it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Itinerary is already paid");
  if (it.groupMode) throw new ApiError(409, "CONFLICT", "This is a group trip — each member pays their own share");

  // Only stops at venues that take bookings are prepaid; pay-at-venue stops are paid on arrival.
  const paid = it.stops.filter((s) => s.status === "PENDING" && s.payMode === "ESCROW");
  if (paid.length === 0) throw new ApiError(400, "BAD_REQUEST", "Nothing to prepay on this trip");
  if (paid.some((s) => !s.merchant)) throw new ApiError(500, "INTERNAL", "A paid stop has no merchant wallet (run db:seed)");
  if (paid.some((s) => !codeHashes[s.id])) throw new ApiError(400, "BAD_REQUEST", "Invalid request");
  const hashes = paid.map((s) => codeHashes[s.id].toLowerCase());
  if (new Set(hashes).size !== hashes.length) throw new ApiError(400, "BAD_REQUEST", "Invalid request");

  const deadline = Math.floor(it.endAt.getTime() / 1000) + REFUND_GRACE_SEC;
  if (deadline <= Math.floor(Date.now() / 1000) + 60) {
    throw new ApiError(410, "EXPIRED", "This itinerary's time window has passed — ask Toura for a new plan");
  }

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(400, "BAD_REQUEST", "No Arc wallet for this user yet");
  const owner = wallet.address as Address;

  // Assign the on-chain id + per-stop indexes once per (unedited) draft; store the code hashes.
  const onchainId = it.onchainId ?? onchainIdFor(`${it.id}:${Date.now()}`);
  await prisma.$transaction([
    prisma.itinerary.update({ where: { id: it.id }, data: { onchainId, deadline: it.deadline ?? deadline } }),
    ...paid.map((s, i) => prisma.stop.update({ where: { id: s.id }, data: { onchainIndex: i, codeHash: hashes[i] } })),
  ]);
  it = (await getItineraryWithStops(itineraryId))!;

  const escrowed = it.stops.filter((s) => s.onchainIndex !== null).sort((a, b) => a.onchainIndex! - b.onchainIndex!);
  const amounts = escrowed.map((s) => toNativeUnits(s.priceUsdc.toString()));
  const total = amounts.reduce((a, b) => a + b, 0n);

  const balance = await nativeUsdcWei(owner);
  if (balance < total) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet", {
      balance: formatUnits(balance, 18),
      required: formatUnits(total, 18),
    });
  }

  const { challengeId } = await createContractExecutionChallenge({
    userToken,
    walletId: wallet.id,
    contractAddress: escrow,
    abiFunctionSignature: "deposit(bytes32,address[],uint256[],bytes32[],uint64)",
    abiParameters: [
      it.onchainId!,
      escrowed.map((s) => s.merchant!.walletAddress),
      amounts.map((a) => a.toString()),
      escrowed.map((s) => s.codeHash!),
      String(it.deadline ?? deadline),
    ],
    amount: formatUnits(total, 18),
    refId: `deposit:${it.id}`,
  });
  return NextResponse.json({ challengeId, total: formatUnits(total, 18) });
});
