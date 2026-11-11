import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { getArcWallet } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { refundStop } from "@/lib/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.discriminatedUnion("mode", [
  // User cancels one stop. Ownership is proven with the Circle user token:
  // the user's Arc wallet must be the on-chain payer.
  z.object({ mode: z.literal("cancel"), stopId: z.string().min(1).max(64), userToken: z.string().min(10).max(4000) }),
  // Cron: refund every unused stop of itineraries that ended more than 2h ago.
  z.object({ mode: z.literal("sweep") }),
]);

const GRACE_MS = 2 * 3600_000;
const SWEEP_BATCH = 20;

export const POST = handle(async (req: Request) => {
  if (!rateLimit(`refund:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Body);

  if (body.mode === "cancel") {
    const stop = await prisma.stop.findUnique({ where: { id: body.stopId }, include: { itinerary: true } });
    if (!stop) throw new ApiError(404, "NOT_FOUND", "Stop not found");
    if (stop.itinerary.status !== "PAID" || !stop.itinerary.onchainId || !stop.itinerary.payerAddress) {
      throw new ApiError(409, "CONFLICT", "Itinerary is not paid");
    }
    const wallet = await getArcWallet(body.userToken);
    if (!wallet || getAddress(wallet.address) !== getAddress(stop.itinerary.payerAddress)) {
      throw new ApiError(403, "FORBIDDEN", "Only the wallet that paid can cancel this stop");
    }
    const txHash = await refundStop(stop, stop.itinerary.onchainId);
    return NextResponse.json({
      ok: true,
      txHash,
      explorerTxUrl: config.explorerUrl ? `${config.explorerUrl}/tx/${txHash}` : null,
    });
  }

  // sweep
  const secret = config.cronSecret;
  if (secret && req.headers.get("x-cron-secret") !== secret) throw new ApiError(403, "FORBIDDEN", "Bad cron secret");

  const stops = await prisma.stop.findMany({
    where: {
      status: "PENDING",
      onchainIndex: { not: null },
      itinerary: { status: "PAID", endAt: { lt: new Date(Date.now() - GRACE_MS) }, onchainId: { not: null } },
    },
    include: { itinerary: true },
    take: SWEEP_BATCH,
  });
  const results: { stopId: string; ok: boolean; txHash?: string; error?: string }[] = [];
  for (const s of stops) {
    try {
      results.push({ stopId: s.id, ok: true, txHash: await refundStop(s, s.itinerary.onchainId!) });
    } catch (err) {
      results.push({ stopId: s.id, ok: false, error: (err as Error).message });
    }
  }
  return NextResponse.json({ processed: results.length, results });
});
