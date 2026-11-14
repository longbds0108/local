// Server-side configuration. Values come from .env only — nothing chain-specific is
// hardcoded here (see .env.example for where each value comes from).
import os from "node:os";
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
    return read("DATA_DIR") ?? path.resolve(process.cwd(), "data");
  },
  /**
   * Best-effort disk cache for public map services. Serverless platforms (Vercel)
   * only allow writing to the temp dir, and it doesn't outlive the instance.
   */
  get cacheDir() {
    return read("CACHE_DIR") ?? (process.env.VERCEL ? path.join(os.tmpdir(), "toura-cache") : path.join(this.dataDir, "cache"));
  },
  /** DeepSeek, through its Anthropic-compatible Messages endpoint. */
  get aiBaseUrl() {
    return (read("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
  },
  get aiApiKey() {
    return read("DEEPSEEK_API_KEY");
  },
  get aiModel() {
    return read("DEEPSEEK_MODEL") ?? "deepseek-flash";
  },
  /** Thinking mode: on unless DEEPSEEK_THINKING=off (faster replies, shallower plans). */
  get aiThinking() {
    return read("DEEPSEEK_THINKING") !== "off";
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
  /** Wallet payments without the escrow: starting a trip, paying at the venue, sending USDC. */
  get walletPaymentsConfigured() {
    return ["CIRCLE_API_KEY", "ARC_RPC_URL", "ARC_CHAIN_ID"].every((n) => !!read(n));
  },
  /** Prepaid (escrow) payments: everything above plus the deployed escrow contract. */
  get paymentsConfigured() {
    return ["CIRCLE_API_KEY", "ARC_RPC_URL", "ARC_CHAIN_ID", "ESCROW_ADDRESS"].every((n) => !!read(n));
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
