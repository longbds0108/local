import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { toView } from "@/lib/itinerary";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).max(10) });

/**
 * Unpaid itineraries this browser planned (ids from its local storage).
 * No wallet needed: a draft has no owner until it is paid, and its id is an
 * unguessable cuid (same model as the /trips/[id] link). `done` lists ids the
 * browser can forget: paid since (they now show under the wallet) or gone.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`drafts:${clientIp(req)}`, 30, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { ids } = await parseJson(req, Body);
  if (!ids.length) return NextResponse.json({ drafts: [], done: [] });
  const rows = await prisma.itinerary.findMany({
    where: { id: { in: ids } },
    include: { stops: { include: { merchant: true }, orderBy: { order: "asc" } } },
  });
  const drafts = rows.filter((r) => r.status === "DRAFT").map(toView);
  const keep = new Set(drafts.map((d) => d.id));
  // Keep the browser's order (newest first).
  drafts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return NextResponse.json({ drafts, done: ids.filter((id) => !keep.has(id)) });
});
