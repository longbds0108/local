import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { createDeviceToken } from "@/lib/circle";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({ deviceId: z.string().min(8).max(200) });

/** deviceId comes from the Circle Web SDK; the token is created with our server-side API key. */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-dt:${clientIp(req)}`, 10, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { deviceId } = await parseJson(req, Body);
  const { deviceToken, deviceEncryptionKey } = await createDeviceToken(deviceId);
  return NextResponse.json({ deviceToken, deviceEncryptionKey });
});
