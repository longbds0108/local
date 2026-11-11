// Shared client for the public Photon instance (komoot, OSM data, no key).
// Fair use matters: the public server blocks IPs that send too much, so every
// response is cached on disk and a circuit breaker stops all calls for a while
// after a refusal / 429 / 5xx. Off unless PHOTON_URL is set: the public
// instance blocks some networks outright (connection refused), and its roles are
// covered by BigDataCloud (browser geocoding) and vector tiles (places).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "./env";

const BREAK_MS = 15 * 60_000;
let downUntil = 0;

export function photonHealthy(): boolean {
  return Date.now() >= downUntil;
}

function base(): string | null {
  const url = process.env.PHOTON_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function cacheFile(key: string) {
  return path.join(config.cacheDir, `photon-${createHash("sha1").update(key).digest("hex").slice(0, 16)}.json`);
}

async function readCache<T>(key: string, ttlMs: number): Promise<T | undefined> {
  try {
    const { at, value } = JSON.parse(await fs.readFile(cacheFile(key), "utf8")) as { at: number; value: T };
    if (Date.now() - at < ttlMs) return value;
  } catch {
    /* miss */
  }
  return undefined;
}

async function writeCache(key: string, value: unknown) {
  try {
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile(key), JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* best effort */
  }
}

/**
 * GET {PHOTON_URL}{pathAndQuery} → parsed JSON, or null when unavailable.
 * Successful answers are cached on disk for `ttlMs`.
 */
export async function photonGet<T>(pathAndQuery: string, ttlMs: number): Promise<T | null> {
  const cached = await readCache<T>(pathAndQuery, ttlMs);
  if (cached !== undefined) return cached;
  const b = base();
  if (!b || !photonHealthy()) return null;
  try {
    const res = await fetch(`${b}${pathAndQuery}`, {
      headers: { "User-Agent": "PayAgent/0.1 (demo)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      downUntil = Date.now() + BREAK_MS;
      console.warn(`[photon] HTTP ${res.status} — pausing calls for 15 min`);
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as T;
    await writeCache(pathAndQuery, json);
    return json;
  } catch (err) {
    // Connection refused/reset usually means the public instance blocked us.
    downUntil = Date.now() + BREAK_MS;
    console.warn("[photon] unreachable — pausing calls for 15 min:", (err as Error).message);
    return null;
  }
}
