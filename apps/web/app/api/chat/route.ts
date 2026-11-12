import { z } from "zod";
import { classifyAgentError, runChatTurn } from "@/lib/agent";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { CITY } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import type { ChatEvent } from "@/lib/types";
import { walletForToken } from "@/lib/wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(2000),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locale: z.enum(["vi", "en"]).default("vi"),
  area: z.string().trim().max(160).optional(),
  // Circle user token: the AI is only for signed-in wallets (keeps spam and cost down).
  userToken: z.string().min(10).max(4000).optional(),
});

// Per wallet, on top of the per-IP limit.
const WALLET_LIMITS = [
  { name: "minute", limit: 10, windowMs: 60_000 },
  { name: "day", limit: 200, windowMs: 86_400_000 },
] as const;

const busy = new Set<string>();

export const POST = handle(async (req: Request) => {
  const rl = rateLimit(`chat:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    const res = jsonError(429, "RATE_LIMITED", `Too many requests, retry in ${rl.retryAfterSec}s`);
    res.headers.set("Retry-After", String(rl.retryAfterSec));
    return res;
  }

  const body = await parseJson(req, Body);

  if (!body.userToken) throw new ApiError(401, "WALLET_REQUIRED", "Sign in with your wallet to use the AI");
  // Expired/invalid tokens throw here and become 401 UNAUTHORIZED.
  const wallet = await walletForToken(body.userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Create your wallet to use the AI");
  for (const w of WALLET_LIMITS) {
    const r = rateLimit(`chat-wallet-${w.name}:${wallet}`, w.limit, w.windowMs);
    if (!r.ok) {
      const res = jsonError(429, "RATE_LIMITED", `Too many requests, retry in ${r.retryAfterSec}s`);
      res.headers.set("Retry-After", String(r.retryAfterSec));
      return res;
    }
  }

  // Starting point: the user's GPS wherever they are; Vũng Tàu center without GPS.
  let start: { lat: number; lon: number } = CITY.center;
  let startIsGps = false;
  if (body.lat !== undefined && body.lon !== undefined) {
    start = { lat: body.lat, lon: body.lon };
    startIsGps = true;
  }

  let session = body.sessionId ? await prisma.chatSession.findUnique({ where: { id: body.sessionId } }) : null;
  // A chat belongs to the wallet that started it: another wallet's id just starts a fresh chat,
  // and an older chat without an owner is claimed by the first wallet that continues it.
  if (session?.walletAddress && session.walletAddress !== wallet) session = null;
  if (session && !session.walletAddress) {
    session = await prisma.chatSession.update({ where: { id: session.id }, data: { walletAddress: wallet } });
  }
  if (!session) {
    session = await prisma.chatSession.create({ data: { startLat: start.lat, startLon: start.lon, walletAddress: wallet } });
  }
  const sessionId = session.id;

  if (busy.has(sessionId)) throw new ApiError(409, "CONFLICT", "A reply is still being generated for this chat");
  busy.add(sessionId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (ev: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Overall deadline for one chat turn (all tool iterations).
      const deadline = AbortSignal.timeout(240_000);
      const signal = AbortSignal.any([req.signal, deadline]);
      send({ type: "session", sessionId });
      try {
        await runChatTurn({ sessionId, userText: body.message, start, startIsGps, area: body.area, locale: body.locale, send, signal });
      } catch (err) {
        const { code, message } = deadline.aborted ? { code: "AI_TIMEOUT", message: "AI timed out" } : classifyAgentError(err);
        if (!req.signal.aborted) console.error("[chat] turn failed", err);
        send({ type: "error", code, message });
      } finally {
        busy.delete(sessionId);
        send({ type: "done" });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
