import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { getRoute } from "@/lib/osrm";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  points: z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })).min(2).max(10),
  profile: z.enum(["driving", "walking", "bike"]).default("driving"),
});

export const POST = handle(async (req: Request) => {
  if (!rateLimit(`route:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Body);
  return NextResponse.json(await getRoute(body.points, body.profile));
});
