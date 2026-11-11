import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { operatorCall } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { recomputeItineraryStatus } from "@/lib/itinerary";
import { verifyStopSig } from "@/lib/qr";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  stopId: z.string().min(1).max(64),
  sig: z.string().regex(/^[0-9a-f]{64}$/i),
  merchantId: z.string().min(1).max(64),
});

/**
 * Merchant scanned a voucher QR. Verify it, then release that stop's USDC on-chain
 * to the merchant using the operator key.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`checkin:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { stopId, sig, merchantId } = await parseJson(req, Body);

  const stop = await prisma.stop.findUnique({ where: { id: stopId }, include: { itinerary: true, merchant: true } });
  // Same response for unknown stop and bad signature: don't leak which stop ids exist.
  if (!stop || !verifyStopSig(stop.id, stop.qrSecret, sig)) throw new ApiError(400, "BAD_REQUEST", "Invalid voucher");
  if (stop.merchantId !== merchantId) {
    throw new ApiError(403, "FORBIDDEN", "This QR code belongs to another partner");
  }
  if (stop.itinerary.status !== "PAID") throw new ApiError(409, "CONFLICT", `Itinerary is not in PAID state (${stop.itinerary.status})`);
  if (stop.status !== "PENDING") throw new ApiError(409, "CONFLICT", `Voucher already used (${stop.status})`);
  const deadline = stop.itinerary.deadline;
  if (!deadline || Date.now() / 1000 >= deadline) throw new ApiError(410, "EXPIRED", "Voucher expired");
  if (stop.onchainIndex === null || !stop.itinerary.onchainId) throw new ApiError(409, "CONFLICT", "Stop is not escrowed on-chain");

  // Lock the stop so two scans can't release twice (the contract also prevents it).
  const locked = await prisma.stop.updateMany({
    where: { id: stop.id, status: "PENDING" },
    data: { status: "CHECKED_IN", checkedInAt: new Date() },
  });
  if (locked.count !== 1) throw new ApiError(409, "CONFLICT", "Voucher is being processed");

  let txHash: Hex;
  try {
    txHash = await operatorCall("release", stop.itinerary.onchainId as Hex, stop.onchainIndex);
  } catch (err) {
    await prisma.stop.update({ where: { id: stop.id }, data: { status: "PENDING", checkedInAt: null } });
    console.error("[checkin] release failed", err);
    throw new ApiError(502, "CHAIN_ERROR", `On-chain release failed: ${(err as Error).message.split("\n")[0]}`);
  }

  await prisma.stop.update({ where: { id: stop.id }, data: { status: "RELEASED", releaseTx: txHash } });
  await recomputeItineraryStatus(stop.itineraryId);

  return NextResponse.json({
    ok: true,
    stop: { id: stop.id, name: stop.name, amountUsdc: stop.priceUsdc.toString() },
    merchant: stop.merchant ? { id: stop.merchant.id, name: stop.merchant.name, walletAddress: stop.merchant.walletAddress } : null,
    txHash,
    explorerTxUrl: config.explorerUrl ? `${config.explorerUrl}/tx/${txHash}` : null,
  });
});
