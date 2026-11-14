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

const Body = z.object({ userToken: z.string().min(10).max(4000), stopId: z.string().min(1).max(64) });

/**
 * A member pays their part of a venue bill: ONE Circle challenge for a USDC transfer
 * from their wallet straight to the venue's wallet. Amount and venue come from the DB;
 * the payment is confirmed afterwards from the chain (/api/group/bill/confirm).
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`group-bill-pay:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, stopId } = await parseJson(req, Body);
  const bill = await prisma.venueBill.findUnique({ where: { stopId }, include: { parts: true, stop: { include: { merchant: true, itinerary: true } } } });
  if (!bill || !bill.stop.merchant) throw new ApiError(404, "NOT_FOUND", "Stop not found");
  if (bill.stop.itinerary.status !== "PAID" || bill.stop.status !== "PENDING") throw new ApiError(409, "CONFLICT", `Already paid (${bill.stop.status})`);

  const wallet = await getArcWallet(userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet first");
  const me = getAddress(wallet.address);
  const part = bill.parts.find((p) => getAddress(p.payerAddress) === me);
  if (!part) throw new ApiError(403, "FORBIDDEN", "You're not on this bill");
  if (part.status === "PAID") throw new ApiError(409, "CONFLICT", "You've already paid your part");

  const value = parseUnits(part.amountUsdc, 6);
  const balance = await nativeUsdcWei(me as Address);
  if (balance < value * 10n ** 12n) {
    throw new ApiError(402, "INSUFFICIENT_USDC", "Not enough USDC in the wallet — get testnet USDC from the faucet");
  }
  // Where to look for the transfer (kept from the first attempt).
  if (part.fromBlock === null) {
    const block = await currentBlock();
    await prisma.venueBillPart.update({ where: { id: part.id }, data: { fromBlock: Number(block > 5n ? block - 5n : 0n) } });
  }
  const { challengeId } = await createContractExecutionChallenge({
    userToken,
    walletId: wallet.id,
    contractAddress: usdcErc20(),
    abiFunctionSignature: "transfer(address,uint256)",
    abiParameters: [bill.stop.merchant.walletAddress, value.toString()],
    refId: `bill:${part.id}`,
  });
  return NextResponse.json({ challengeId });
});
