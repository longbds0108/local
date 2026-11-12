// Tools the Toura agent can call. Every input is validated with zod here
// (never trust the model's tool input as-is),
// and build_itinerary re-derives times and prices on the server rather than
// trusting numbers from the model.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "./db";
import type { LatLon } from "./geo";
import { openThroughout } from "./hours";
import { getItineraryView } from "./itinerary";
import { getRoute, type Profile } from "./osrm";
import { paySplit } from "./pay-modes";
import type { PayMode } from "./types";
import { PARTNER_POOL_MERCHANT_ID, resolvePlace, searchPlaces, type Place } from "./places";
import { partyPrice } from "./pricing";
import { newQrSecret } from "./qr";
import { addMinutes, hhmm } from "./time";
import type { ChatEvent, MapPlace } from "./types";

export class ToolInputError extends Error {}

export type ToolContext = {
  sessionId: string;
  start: LatLon;
  send: (ev: ChatEvent) => void;
};

const CATEGORY_ENUM = ["beach", "viewpoint", "attraction", "museum", "restaurant", "cafe"];

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_places",
    description:
      "Search real places near a point (OpenStreetMap via Overpass/Photon, plus curated Vung Tau seed data with merchants). Returns osmId, name, coordinates, category, tags/cuisine, opening hours, per-person priceUsdc (priceSource 'estimate' means a category estimate) and whether the place is open during the given time window. Places closed during the window are excluded. Only places returned here may be used in an itinerary.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude of the search center" },
        lon: { type: "number", description: "Longitude of the search center" },
        radiusM: { type: "integer", description: "Search radius in meters (300-8000). Default 4000." },
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORY_ENUM },
          description: "Filter by category. Empty = all.",
        },
        limit: { type: "integer", description: "Max results (1-40). Default 15." },
        windowStart: { type: "string", description: "ISO 8601 start of the visit window (with +07:00 offset), used to exclude closed places" },
        windowEnd: { type: "string", description: "ISO 8601 end of the visit window" },
      },
      required: ["lat", "lon"],
    },
  },
  {
    name: "get_route",
    description:
      "Travel time and distance between consecutive points (OSRM). Pass the starting location first, then stops in visiting order. Returns one leg per consecutive pair.",
    input_schema: {
      type: "object",
      properties: {
        points: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          items: {
            type: "object",
            properties: { lat: { type: "number" }, lon: { type: "number" } },
            required: ["lat", "lon"],
          },
        },
        profile: { type: "string", enum: ["driving", "walking", "bike"], description: "Default driving (taxi/motorbike)" },
      },
      required: ["points"],
    },
  },
  {
    name: "build_itinerary",
    description:
      "Save the itinerary (creates the draft, or replaces the stops of the current DRAFT itinerary when the user is editing). The server recomputes arrival times from real travel times, checks opening hours and computes prices = per-person price x partySize. Returns itineraryId, totalUsdc and the authoritative schedule; returns an error to fix if the plan does not fit.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title in the user's language" },
        startAt: { type: "string", description: "ISO 8601 with offset, e.g. 2026-11-10T14:00:00+07:00" },
        endAt: { type: "string", description: "ISO 8601 with offset" },
        partySize: { type: "integer", minimum: 1, maximum: 20 },
        profile: { type: "string", enum: ["driving", "walking", "bike"] },
        stops: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              osmId: { type: "string", description: "osmId exactly as returned by search_places" },
              arriveAt: { type: "string", description: "Planned arrival, ISO 8601 with offset" },
              durationMin: { type: "integer", minimum: 10, maximum: 300 },
              priceUsdc: { type: "number", description: "Your expected price for the party (informational; server recomputes)" },
              note: { type: "string", description: "Why this stop fits the request, one short sentence (max ~90 chars) in the UI language, e.g. 'Ven biển, hợp ngắm hoàng hôn, rẻ hơn ngân sách'" },
            },
            required: ["osmId", "arriveAt", "durationMin"],
          },
        },
      },
      required: ["title", "startAt", "endAt", "partySize", "stops"],
    },
  },
];

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO 8601 date-time");

const SearchInput = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: z.number().int().optional(),
  categories: z.array(z.string()).optional(),
  limit: z.number().int().optional(),
  windowStart: isoDate.optional(),
  windowEnd: isoDate.optional(),
});

const RouteInput = z.object({
  points: z.array(z.object({ lat: z.number(), lon: z.number() })).min(2).max(10),
  profile: z.enum(["driving", "walking", "bike"]).optional(),
});

const BuildInput = z.object({
  title: z.string().min(1).max(120),
  startAt: isoDate,
  endAt: isoDate,
  partySize: z.number().int().min(1).max(20),
  profile: z.enum(["driving", "walking", "bike"]).optional(),
  stops: z
    .array(
      z.object({
        osmId: z.string().min(3),
        arriveAt: isoDate,
        durationMin: z.number().int().min(10).max(300),
        priceUsdc: z.number().optional(),
        note: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(8),
});

function toMapPlace(p: Place & { distanceM: number }): MapPlace {
  return {
    osmId: p.osmId,
    name: p.name,
    nameEn: p.nameEn,
    lat: p.lat,
    lon: p.lon,
    category: p.category,
    openingHours: p.openingHours,
    priceUsdc: p.priceUsdc,
    priceSource: p.priceSource,
    merchantId: p.merchantId,
    distanceM: p.distanceM,
    source: p.source,
  };
}

async function runSearch(raw: unknown, ctx: ToolContext) {
  const input = SearchInput.parse(raw);
  const results = await searchPlaces({
    lat: input.lat,
    lon: input.lon,
    radiusM: input.radiusM ?? 4000,
    categories: input.categories,
    limit: input.limit ?? 15,
    windowStart: input.windowStart ? new Date(input.windowStart) : undefined,
    windowEnd: input.windowEnd ? new Date(input.windowEnd) : undefined,
  });
  ctx.send({ type: "places", places: results.map(toMapPlace) });
  return {
    count: results.length,
    places: results.map((p) => ({
      osmId: p.osmId,
      name: p.name,
      nameEn: p.nameEn,
      lat: Number(p.lat.toFixed(5)),
      lon: Number(p.lon.toFixed(5)),
      category: p.category,
      tags: p.tags,
      cuisine: p.cuisine,
      openingHours: p.openingHours ?? null,
      openDuringWindow: p.openDuringWindow,
      priceUsdcPerPerson: p.priceUsdc,
      priceSource: p.priceSource,
      suggestedMin: p.suggestedMin,
      distanceM: p.distanceM,
    })),
  };
}

async function runRoute(raw: unknown) {
  const input = RouteInput.parse(raw);
  const r = await getRoute(input.points, input.profile ?? "driving");
  // Geometry is omitted for the model (large); the map renders it after build_itinerary.
  return { legs: r.legs, totalMin: r.totalMin, totalKm: r.totalKm, approximate: r.approximate, geometry: "omitted (drawn on map)" };
}

async function runBuild(raw: unknown, ctx: ToolContext) {
  const input = BuildInput.parse(raw);
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  const profile: Profile = input.profile ?? "driving";
  if (endAt <= startAt) throw new ToolInputError("endAt must be after startAt");
  if (endAt.getTime() - startAt.getTime() > 16 * 3600_000) throw new ToolInputError("The window must be at most 16 hours");
  if (endAt.getTime() < Date.now()) throw new ToolInputError("endAt is in the past — use the local time from the context block");

  const ids = input.stops.map((s) => s.osmId);
  if (new Set(ids).size !== ids.length) throw new ToolInputError("Each place may appear only once");

  const places: Place[] = [];
  const unknown: string[] = [];
  for (const s of input.stops) {
    const p = await resolvePlace(s.osmId, ctx.start);
    if (p) places.push(p);
    else unknown.push(s.osmId);
  }
  if (unknown.length) {
    throw new ToolInputError(`Unknown osmId(s): ${unknown.join(", ")}. Use only osmIds returned by search_places.`);
  }

  const route = await getRoute([ctx.start, ...places], profile);

  // Recompute the schedule: never arrive before you can get there.
  const problems: string[] = [];
  const schedule: { arrive: Date; depart: Date; travelMin: number }[] = [];
  let prevDepart = startAt;
  input.stops.forEach((s, i) => {
    const travelMin = route.legs[i]?.durationMin ?? 0;
    const earliest = addMinutes(prevDepart, travelMin);
    const planned = new Date(s.arriveAt);
    const arrive = planned > earliest ? planned : earliest;
    const depart = addMinutes(arrive, s.durationMin);
    schedule.push({ arrive, depart, travelMin });
    const open = openThroughout(places[i].openingHours, arrive, depart);
    if (open === false) {
      problems.push(`${places[i].name} (${places[i].osmId}) is closed during ${hhmm(arrive)}-${hhmm(depart)} (opening_hours: ${places[i].openingHours})`);
    }
    prevDepart = depart;
  });
  const overrunMin = Math.round((prevDepart.getTime() - endAt.getTime()) / 60_000);
  if (overrunMin > 10) {
    problems.push(
      `The plan ends at ${hhmm(prevDepart)}, ${overrunMin} min after endAt ${hhmm(endAt)}. Shorten durations, drop a stop, or pick closer places.`,
    );
  }
  if (problems.length) {
    throw new ToolInputError(
      `Itinerary not saved:\n- ${problems.join("\n- ")}\nComputed schedule: ${schedule
        .map((x, i) => `${places[i].name} ${hhmm(x.arrive)}-${hhmm(x.depart)} (+${x.travelMin} min travel)`)
        .join("; ")}`,
    );
  }

  // Partner venues decide how they are paid: bookings are prepaid into the escrow,
  // walk-in venues are paid on arrival. Anywhere else is an estimate the traveller pays themselves.
  const partners = new Map((await prisma.merchant.findMany()).filter((m) => m.id !== PARTNER_POOL_MERCHANT_ID).map((m) => [m.id, m]));
  const stopsData = input.stops.map((s, i) => {
    const p = places[i];
    const price = partyPrice(p.priceUsdc, input.partySize);
    const partner = price > 0 && p.merchantId ? partners.get(p.merchantId) : undefined;
    const payMode: PayMode = !(price > 0) ? "NONE" : !partner ? "SELF" : partner.prepay ? "ESCROW" : "VENUE";
    return {
      order: i,
      osmId: p.osmId,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      category: p.category,
      arriveAt: schedule[i].arrive,
      durationMin: s.durationMin,
      travelMin: schedule[i].travelMin,
      priceUsdc: price.toFixed(2),
      priceSource: p.priceSource,
      note: s.note ?? null,
      merchantId: partner?.id ?? null,
      qrSecret: newQrSecret(),
      payMode,
      status: payMode === "ESCROW" || payMode === "VENUE" ? "PENDING" : "FREE",
    };
  });
  const total = stopsData.reduce((sum, s) => sum + Number(s.priceUsdc), 0);
  const split = paySplit(stopsData);

  const session = await prisma.chatSession.findUniqueOrThrow({ where: { id: ctx.sessionId }, include: { itinerary: true } });
  const editable = session.itinerary && session.itinerary.status === "DRAFT" ? session.itinerary : null;
  const base = {
    title: input.title,
    startAt,
    endAt,
    partySize: input.partySize,
    totalUsdc: total.toFixed(2),
    profile,
    geometry: JSON.stringify(route.geometry),
    // Amounts may change, so any onchain id assigned for an earlier payment attempt is reset.
    onchainId: null,
    deadline: null,
  };

  const itineraryId = await prisma.$transaction(async (tx) => {
    if (editable) {
      await tx.stop.deleteMany({ where: { itineraryId: editable.id } });
      await tx.itinerary.update({ where: { id: editable.id }, data: { ...base, stops: { create: stopsData } } });
      return editable.id;
    }
    const created = await tx.itinerary.create({ data: { ...base, status: "DRAFT", stops: { create: stopsData } } });
    await tx.chatSession.update({ where: { id: ctx.sessionId }, data: { itineraryId: created.id } });
    return created.id;
  });

  const view = await getItineraryView(itineraryId);
  if (view) ctx.send({ type: "itinerary", itinerary: view });

  return {
    itineraryId,
    updatedExistingDraft: !!editable,
    totalUsdc: total.toFixed(2),
    // When the money is paid: now (deposit), at the venue in the app, or by the traveller on their own.
    prepayNowUsdc: split.prepay.toFixed(2),
    payAtVenueUsdc: split.atVenue.toFixed(2),
    payYourselfUsdc: split.self.toFixed(2),
    partySize: input.partySize,
    endsAt: hhmm(prevDepart),
    routeApproximate: route.approximate,
    stops: stopsData.map((s, i) => ({
      order: i + 1,
      name: s.name,
      arrive: hhmm(s.arriveAt),
      depart: hhmm(schedule[i].depart),
      travelMinFromPrevious: s.travelMin,
      priceUsdc: s.priceUsdc,
      priceSource: s.priceSource,
      payment: PAYMENT_LABEL[s.payMode],
    })),
  };
}

const PAYMENT_LABEL: Record<PayMode, string> = {
  ESCROW: "prepay (deposit held in escrow, released to the venue on arrival)",
  VENUE: "pay_at_venue (traveller scans the venue's QR and pays in USDC on arrival)",
  SELF: "pay_yourself (not a Toura partner; price is an estimate, paid outside the app)",
  NONE: "free",
};

const SUMMARY: Record<string, (out: unknown) => string> = {
  search_places: (o) => String((o as { count: number }).count),
  get_route: (o) => String((o as { totalMin: number }).totalMin),
  build_itinerary: (o) => String((o as { totalUsdc: string }).totalUsdc),
};

/** Executes one tool call. Returns the tool_result content and whether it is an error. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  ctx.send({ type: "tool", name, status: "start" });
  try {
    let out: unknown;
    if (name === "search_places") out = await runSearch(input, ctx);
    else if (name === "get_route") out = await runRoute(input);
    else if (name === "build_itinerary") out = await runBuild(input, ctx);
    else throw new ToolInputError(`Unknown tool ${name}`);
    ctx.send({ type: "tool", name, status: "done", summary: SUMMARY[name]?.(out) });
    return { content: JSON.stringify(out), isError: false };
  } catch (err) {
    ctx.send({ type: "tool", name, status: "error" });
    if (err instanceof z.ZodError) {
      return { content: JSON.stringify({ INVALID_INPUT: z.flattenError(err) }), isError: true };
    }
    if (err instanceof ToolInputError) return { content: err.message, isError: true };
    console.error(`[tool ${name}] failed`, err);
    return { content: `Tool failed: ${(err as Error).message}`, isError: true };
  }
}
