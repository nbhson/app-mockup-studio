/**
 * Rate limit store abstraction (plan/12 GĐ 6.1 — production hardening).
 *
 * The `AiRateLimitGuard` delegates window bookkeeping to a `RateLimitStore` so
 * a single API instance can use the lightweight in-memory implementation while
 * multi-instance deployments plug in `RedisRateLimitStore` (shared counters).
 */

export interface RateLimitHit {
  /** Whether the request is allowed under the current limit. */
  allowed: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
  /** Remaining allowed requests in the current window. */
  remaining: number;
}

export interface RateLimitStore {
  /** Register one request for `key` and report whether it is allowed. */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitHit>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Single-instance sliding one-minute window kept in process memory. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    if (this.buckets.size > 10_000) this.prune(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        remaining: 0,
      };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - bucket.count };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
