import { z } from "zod";
import { classifyAgentError, runChatTurn } from "@/lib/agent";
import { ApiError, clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { CITY } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import type { ChatEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1).max(2000),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locale: z.enum(["vi", "en"]).default("vi"),
});

const busy = new Set<string>();

export const POST = handle(async (req: Request) => {
  const rl = rateLimit(`chat:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    const res = jsonError(429, "RATE_LIMITED", `Too many requests, retry in ${rl.retryAfterSec}s`);
    res.headers.set("Retry-After", String(rl.retryAfterSec));
    return res;
  }

  const body = await parseJson(req, Body);

  // Starting point: the user's GPS wherever they are; Vũng Tàu center without GPS.
  let start: { lat: number; lon: number } = CITY.center;
  let startIsGps = false;
  if (body.lat !== undefined && body.lon !== undefined) {
    start = { lat: body.lat, lon: body.lon };
    startIsGps = true;
  }

  let session = body.sessionId ? await prisma.chatSession.findUnique({ where: { id: body.sessionId } }) : null;
  if (!session) session = await prisma.chatSession.create({ data: { startLat: start.lat, startLon: start.lon } });
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
        await runChatTurn({ sessionId, userText: body.message, start, startIsGps, locale: body.locale, send, signal });
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
