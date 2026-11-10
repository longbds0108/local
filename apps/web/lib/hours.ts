import OpeningHours from "opening_hours";
import { toCityWallClock } from "./time";

const cache = new Map<string, OpeningHours | null>();

function parse(value: string): OpeningHours | null {
  if (cache.has(value)) return cache.get(value)!;
  let oh: OpeningHours | null = null;
  try {
    // Country context for public holidays (Vietnam). Unknown/invalid rules → null (treated as unknown).
    oh = new OpeningHours(value, { lat: 10.346, lon: 107.0843, address: { country_code: "vn", state: "" } });
  } catch {
    oh = null;
  }
  cache.set(value, oh);
  return oh;
}

/**
 * Minutes the place is open within [start, end]. Returns null when there is no
 * (parseable) opening_hours tag — the caller should treat that as "unknown".
 */
export function openMinutesBetween(value: string | undefined, start: Date, end: Date): number | null {
  if (!value) return null;
  const oh = parse(value);
  if (!oh) return null;
  const from = toCityWallClock(start);
  const to = toCityWallClock(end);
  if (to <= from) return 0;
  const [openMs] = oh.getOpenDuration(from, to);
  return Math.round(openMs / 60_000);
}

/** true = open for the whole visit, false = closed for part of it, null = unknown. */
export function openThroughout(value: string | undefined, start: Date, end: Date): boolean | null {
  const open = openMinutesBetween(value, start, end);
  if (open === null) return null;
  const total = Math.round((end.getTime() - start.getTime()) / 60_000);
  // 1-minute rounding tolerance only makes sense for real visits, not tiny windows.
  return open >= (total >= 10 ? total - 1 : total);
}

/** Is the place open at this instant? null = unknown. */
export function isOpenAt(value: string | undefined, at: Date): boolean | null {
  if (!value) return null;
  const oh = parse(value);
  if (!oh) return null;
  return oh.getState(toCityWallClock(at));
}

/** For search filtering: is the place open at least `minMinutes` within the window? */
export function openDuringWindow(value: string | undefined, start: Date, end: Date, minMinutes = 30): boolean | null {
  const open = openMinutesBetween(value, start, end);
  if (open === null) return null;
  const total = Math.round((end.getTime() - start.getTime()) / 60_000);
  return open >= Math.min(minMinutes, total);
}
