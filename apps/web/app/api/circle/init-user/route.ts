import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { CIRCLE_CODES, CircleError, getArcWallet, initializeUser } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  email: z.string().email().max(200).optional(),
});

/**
 * First call after Google login:
 *  - new user  → { status: "CHALLENGE", challengeId } (client runs sdk.execute to create the wallet)
 *  - existing  → { status: "READY", wallet }          (also after the challenge completes)
 *  - creating  → { status: "PENDING" }                 (wallet not visible yet; poll again)
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-init:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, email } = await parseJson(req, Body);

  try {
    const { challengeId } = await initializeUser(userToken);
    return NextResponse.json({ status: "CHALLENGE", challengeId });
  } catch (err) {
    if (!(err instanceof CircleError && err.code === CIRCLE_CODES.userAlreadyInitialized)) throw err;
  }

  const wallet = await getArcWallet(userToken);
  if (!wallet) return NextResponse.json({ status: "PENDING" });

  const circleUserId = wallet.userId ?? `wallet:${wallet.id}`;
  await prisma.user.upsert({
    where: { circleUserId },
    create: { circleUserId, walletId: wallet.id, walletAddress: wallet.address, email },
    update: { walletId: wallet.id, walletAddress: wallet.address, ...(email ? { email } : {}) },
  });
  return NextResponse.json({ status: "READY", wallet: { id: wallet.id, address: wallet.address } });
});
