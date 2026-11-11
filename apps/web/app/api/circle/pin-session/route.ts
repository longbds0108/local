import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { createPinUser, createUserToken } from "@/lib/circle";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser generates a random id once and keeps it (wallet is tied to it).
const Body = z.object({ userId: z.string().regex(/^hedgora-[0-9a-f-]{36}$/) });

/**
 * "Connect wallet" without Google: ensure a Circle PIN user exists for this
 * browser's random id and return a short-lived session (userToken + encryptionKey).
 * Holding the token is not enough to move funds — every transaction needs the
 * user's PIN, which only ever goes into Circle's own UI.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-pin:${clientIp(req)}`, 10, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userId } = await parseJson(req, Body);
  await createPinUser(userId);
  const { userToken, encryptionKey } = await createUserToken(userId);
  return NextResponse.json({ userToken, encryptionKey });
});
