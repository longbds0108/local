import { NextResponse } from "next/server";
import type { Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { addresses, onchainIdFor, usdcAllowance, usdcBalance } from "@/lib/chain";
import { createContractExecutionChallenge, getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { getItineraryWithStops } from "@/lib/itinerary";
import { toBaseUnits } from "@/lib/pricing";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  itineraryId: z.string().min(1).max(64),
  step: z.enum(["approve", "deposit"]),
});

const REFUND_GRACE_SEC = 2 * 3600; // deadline = endAt + 2h (spec §10)

/**
 * Creates a Circle contract-execution challenge for the user's wallet.
 * Amounts, merchants and the deadline are always derived from the DB — never from the client.
 * Step 1: USDC.approve(escrow, total). Step 2: escrow.deposit(id, merchants, amounts, deadline).
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-pay:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, itineraryId, step } = await parseJson(req, Body);
  const { usdc, escrow } = addresses();

  let it = await getItineraryWithStops(itineraryId);
  if (!it) throw new ApiError(404, "NOT_FOUND", "Itinerary not found");
  if (it.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Itinerary is already paid");

  const paid = it.stops.filter((s) => s.status === "PENDING");
  if (paid.length === 0) throw new ApiError(400, "BAD_REQUEST", "Nothing to pay — every stop in this itinerary is free");
  if (paid.some((s) => !s.merchant)) throw new ApiError(500, "INTERNAL", "A paid stop has no merchant wallet (run db:seed)");

  const deadline = Math.floor(it.endAt.getTime() / 1000) + REFUND_GRACE_SEC;
  if (deadline <= Math.floor(Date.now() / 1000) + 60) {
    throw new ApiError(410, "EXPIRED", "This itinerary's time window has passed — ask Hedgora for a new plan");
  }

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(400, "BAD_REQUEST", "No Arc wallet for this user yet");
  const owner = wallet.address as Address;

  // Assign the on-chain id + per-stop indexes once per (unedited) draft.
  if (!it.onchainId) {
    const onchainId = onchainIdFor(`${it.id}:${Date.now()}`);
    await prisma.$transaction([
      prisma.itinerary.update({ where: { id: it.id }, data: { onchainId, deadline } }),
      ...paid.map((s, i) => prisma.stop.update({ where: { id: s.id }, data: { onchainIndex: i } })),
    ]);
    it = (await getItineraryWithStops(itineraryId))!;
  }
  const escrowed = it.stops.filter((s) => s.onchainIndex !== null).sort((a, b) => a.onchainIndex! - b.onchainIndex!);
  const amounts = escrowed.map((s) => toBaseUnits(s.priceUsdc.toString()));
  const total = amounts.reduce((a, b) => a + b, 0n);

  const balance = await usdcBalance(owner);
  if (balance < total) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet", {
      balance: balance.toString(),
      required: total.toString(),
    });
  }

  if (step === "approve") {
    const { challengeId } = await createContractExecutionChallenge({
      userToken,
      walletId: wallet.id,
      contractAddress: usdc,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [escrow, total.toString()],
      refId: `approve:${it.id}`,
    });
    return NextResponse.json({ challengeId, step, total: total.toString() });
  }

  const allowance = await usdcAllowance(owner);
  if (allowance < total) {
    throw new ApiError(409, "ALLOWANCE_PENDING", "USDC approval not confirmed on-chain yet", {
      allowance: allowance.toString(),
      required: total.toString(),
    });
  }
  const { challengeId } = await createContractExecutionChallenge({
    userToken,
    walletId: wallet.id,
    contractAddress: escrow,
    abiFunctionSignature: "deposit(bytes32,address[],uint256[],uint64)",
    abiParameters: [
      it.onchainId!,
      escrowed.map((s) => s.merchant!.walletAddress),
      amounts.map((a) => a.toString()),
      String(it.deadline ?? deadline),
    ],
    refId: `deposit:${it.id}`,
  });
  return NextResponse.json({ challengeId, step, total: total.toString() });
});
