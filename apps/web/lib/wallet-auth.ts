// Who is calling: the wallet behind a Circle user token. The address always comes
// from Circle, never from the client.
import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { getArcWallet } from "./circle";

// Verified tokens are remembered briefly so each chat message doesn't cost a Circle round trip.
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { address: string; exp: number }>();

/**
 * The checksummed address of the token's Arc wallet, or null if the user has no
 * wallet yet. An expired or invalid token throws CircleError (→ 401 UNAUTHORIZED).
 */
export async function walletForToken(userToken: string): Promise<string | null> {
  const key = createHash("sha256").update(userToken).digest("hex");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.address;

  const wallet = await getArcWallet(userToken);
  if (!wallet) return null;
  const address = getAddress(wallet.address);
  if (cache.size > 5_000) for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
  cache.set(key, { address, exp: now + TTL_MS });
  return address;
}
