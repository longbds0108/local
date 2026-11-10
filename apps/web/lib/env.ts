// Server-side configuration. Values come from .env only — nothing chain-specific is
// hardcoded here (see .env.example for where each value comes from).
import path from "node:path";

export class ConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing configuration: ${missing.join(", ")}. See .env.example / README.`);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function required(...names: string[]): string[] {
  const values = names.map(read);
  const missing = names.filter((_, i) => !values[i]);
  if (missing.length) throw new ConfigError(missing);
  return values as string[];
}

export const config = {
  get dataDir() {
    return read("DATA_DIR") ?? path.resolve(process.cwd(), "../../data");
  },
  get anthropicModel() {
    return read("ANTHROPIC_MODEL") ?? "claude-opus-5-5";
  },
  get anthropicEffort(): "low" | "medium" | "high" | "xhigh" | "max" {
    const v = read("ANTHROPIC_EFFORT");
    return v === "low" || v === "high" || v === "xhigh" || v === "max" ? v : "medium";
  },
  get overpassUrl() {
    return read("OVERPASS_URL") ?? "https://overpass-api.de/api/interpreter";
  },
  get osrmUrl() {
    return (read("OSRM_URL") ?? "https://router.project-osrm.org").replace(/\/$/, "");
  },
  get circleBaseUrl() {
    return (read("CIRCLE_BASE_URL") ?? "https://api.circle.com").replace(/\/$/, "");
  },
  get circleBlockchain() {
    return read("CIRCLE_BLOCKCHAIN") ?? "ARC-TESTNET";
  },
  get circleAccountType() {
    return read("CIRCLE_ACCOUNT_TYPE") === "EOA" ? "EOA" : "SCA";
  },
  get explorerUrl() {
    return read("ARC_EXPLORER_URL")?.replace(/\/$/, "");
  },
  get faucetUrl() {
    return read("NEXT_PUBLIC_FAUCET_URL");
  },
  get cronSecret() {
    return read("CRON_SECRET");
  },
  /** True when everything needed for on-chain payment is configured. */
  get paymentsConfigured() {
    return ["CIRCLE_API_KEY", "ARC_RPC_URL", "ARC_CHAIN_ID", "USDC_ADDRESS", "ESCROW_ADDRESS"].every((n) => !!read(n));
  },
};

/** Demo city. GPS positions further than MAX_DEMO_DISTANCE_KM fall back to the center. */
export const CITY = {
  name: "Vũng Tàu",
  nameEn: "Vung Tau",
  center: { lat: 10.346, lon: 107.0843 },
  timeZone: "Asia/Ho_Chi_Minh",
  maxDistanceKm: 30,
} as const;
