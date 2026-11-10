import { CITY } from "./env";

const TZ = CITY.timeZone;

/** "14:30" in the demo city's local time. */
export function hhmm(date: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(date),
  );
}

/** Human-readable local time with weekday, for the AI context. */
export function localNowString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} (${TZ}, UTC+07:00)`;
}

/**
 * opening_hours evaluates rules in the *process* time zone. Build a Date whose
 * local wall-clock fields equal the demo city's wall clock, so evaluation is
 * correct regardless of where the server runs.
 */
export function toCityWallClock(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

export function addMinutes(date: Date, min: number): Date {
  return new Date(date.getTime() + min * 60_000);
}
