// Client-safe formatting helpers.
const TZ = "Asia/Ho_Chi_Minh";

export function hhmm(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function dayLabel(iso: string, locale: "vi" | "en"): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * The day of a trip next to its hours, so "16:00–19:00" is never mistaken for today:
 * "" for today, the "tomorrow" word, otherwise dd/MM.
 */
export function tripDay(iso: string, tomorrow: string, now = new Date()): string {
  const d = new Date(iso);
  if (ymd(d) === ymd(now)) return "";
  if (ymd(d) === ymd(new Date(now.getTime() + 86_400_000))) return tomorrow;
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
}

export function usdc(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USDC`;
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function distance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export const CATEGORY_COLORS: Record<string, string> = {
  beach: "#2E86DE",
  viewpoint: "#8E44AD",
  attraction: "#D35400",
  museum: "#5D6D7E",
  restaurant: "#E4572E",
  cafe: "#8B5A2B",
};

export const CATEGORY_EMOJI: Record<string, string> = {
  beach: "🏖️",
  viewpoint: "🌅",
  attraction: "📍",
  museum: "🏛️",
  restaurant: "🦐",
  cafe: "☕",
};
