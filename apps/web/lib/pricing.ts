// Demo pricing. Seed data carries hand-entered demo prices; anything else gets a
// per-category estimate and is labelled "ước tính" (estimate) in the UI.

export const CATEGORIES = ["beach", "viewpoint", "attraction", "museum", "restaurant", "cafe"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Per-person estimate in USDC by category. */
export const CATEGORY_ESTIMATE_USDC: Record<Category, number> = {
  beach: 0,
  viewpoint: 0,
  attraction: 1,
  museum: 2,
  restaurant: 8,
  cafe: 3,
};

export type PriceSource = "seed" | "estimate";

export function unitPrice(poi: { category: string; priceUsdc?: number | null }): { unit: number; source: PriceSource } {
  if (typeof poi.priceUsdc === "number") return { unit: poi.priceUsdc, source: "seed" };
  const est = CATEGORY_ESTIMATE_USDC[poi.category as Category] ?? 0;
  return { unit: est, source: "estimate" };
}

/** Price for the whole party, rounded to cents (USDC has 6 decimals, we keep 2 for readability). */
export function partyPrice(unit: number, partySize: number): number {
  return Math.round(unit * partySize * 100) / 100;
}

/** Decimal string (e.g. "12.5") → native USDC on Arc (18 decimals) — what the escrow holds. */
export function toNativeUnits(amount: string | number): bigint {
  const s = typeof amount === "number" ? amount.toFixed(6) : amount;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

/** Decimal string (e.g. "12.5") → USDC base units (6 decimals, ERC-20 view). */
export function toBaseUnits(amount: string | number): bigint {
  const s = typeof amount === "number" ? amount.toFixed(6) : amount;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function formatUsdc(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
