// Fixed-window, in-memory rate limiter (single-instance MVP). Use Redis/Upstash
// or the platform's limiter when running more than one server instance.
const buckets = new Map<string, { windowStart: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now - v.windowStart >= windowMs) buckets.delete(k);
    }
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfterSec: Math.ceil((b.windowStart + windowMs - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}
