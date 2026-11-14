import { NextResponse } from "next/server";
import { getAddress, parseUnits, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { currentBlock, nativeUsdcWei, usdcErc20 } from "@/lib/chain";
import { createContractExecutionChallenge, getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  stopId: z.string().min(1).max(64),
  /** The bill, in USDC — set by the traveller at the venue (the plan's price is only an estimate). */
  amount: z.string().regex(/^\d{1,4}(\.\d{1,2})?$/),
  /** The venue whose QR was scanned; must be this stop's venue. */
  merchantId: z.string().min(1).max(64),
});

/**
 * Pay-at-venue: ONE Circle challenge for a USDC transfer from the traveller's wallet
 * straight to the venue's wallet (no escrow). The venue's address comes from the DB.
 * The payment is confirmed afterwards from the chain (/api/venue-pay/confirm).
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`venue-pay:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, stopId, amount, merchantId } = await parseJson(req, Body);
  const value = parseUnits(amount, 6);
  if (value <= 0n) throw new ApiError(400, "BAD_REQUEST", "Enter an amount");

  const stop = await prisma.stop.findUnique({ where: { id: stopId }, include: { itinerary: true, merchant: true } });
  if (!stop || stop.payMode !== "VENUE" || !stop.merchant) throw new ApiError(404, "NOT_FOUND", "Stop not found");
  if (stop.merchantId !== merchantId) throw new ApiError(403, "FORBIDDEN", "This QR code belongs to another partner");
  if (stop.itinerary.status !== "PAID" || !stop.itinerary.payerAddress) throw new ApiError(409, "CONFLICT", "Start the trip first");
  if (stop.itinerary.groupMode) throw new ApiError(409, "CONFLICT", "Group trip: split the bill with your group");
  if (stop.status !== "PENDING") throw new ApiError(409, "CONFLICT", `Already paid (${stop.status})`);

  const wallet = await getArcWallet(userToken);
  const me = wallet ? getAddress(wallet.address) : null;
  // The trip's payer, or on a group trip any member who paid a share.
  const member =
    !!me &&
    stop.itinerary.groupMode &&
    !!(await prisma.groupShare.findFirst({ where: { itineraryId: stop.itineraryId, payerAddress: me, status: { not: "PENDING" } } }));
  if (!wallet || !me || (me !== getAddress(stop.itinerary.payerAddress) && !member)) {
    throw new ApiError(403, "FORBIDDEN", "Only the wallet that started this trip can pay its stops");
  }
  const balance = await nativeUsdcWei(wallet.address as Address);
  if (balance < value * 10n ** 12n) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet");
  }

  // Remember where to start looking for the transfer (kept from the first attempt).
  if (stop.payFromBlock === null) {
    const block = await currentBlock();
    await prisma.stop.update({ where: { id: stop.id }, data: { payFromBlock: Number(block > 5n ? block - 5n : 0n) } });
  }

  const { challengeId } = await createContractExecutionChallenge({
    userToken,
    walletId: wallet.id,
    contractAddress: usdcErc20(),
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [stop.merchant.walletAddress, value.toString()],
    refId: `venue:${stop.id}`,
  });
  return NextResponse.json({ challengeId });
});
