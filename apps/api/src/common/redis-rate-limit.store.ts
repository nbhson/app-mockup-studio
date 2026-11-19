import { Logger } from "@nestjs/common";
import { createClient } from "redis";
import {
  InMemoryRateLimitStore,
  type RateLimitHit,
  type RateLimitStore,
} from "./rate-limit.store";

/**
 * DI token for the rate limit store selected by the AI module. When `REDIS_URL`
 * is configured the store is shared across API instances; otherwise it falls
 * back to the in-memory store and logs a warning on first use.
 */
export const REDIS_RATE_LIMIT_STORE = Symbol("REDIS_RATE_LIMIT_STORE");

/** Minimal surface the store needs from a node-redis client (mockable in tests). */
export interface RedisClientLike {
  isOpen: boolean;
  incr(key: string): Promise<number>;
  pExpire(key: string, ms: number): Promise<unknown>;
  pTTL(key: string): Promise<number>;
  connect(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

const CONNECT_TIMEOUT_MS = 2_000;

/**
 * Multi-instance rate limiter backed by Redis (atomic INCR + PEXPIRE per key).
 *
 * - Shared counters across instances of the API.
 * - Lazy connection: connects on the first request and only when configured.
 * - Graceful fallback to in-memory limiting if Redis is unreachable, so a
 *   transient Redis outage never takes the AI endpoints down (each instance
 *   keeps a per-instance limit until Redis recovers).
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private readonly fallback = new InMemoryRateLimitStore();
  private attached = false;

  constructor(
    private readonly client: RedisClientLike | null,
    private readonly url: string | undefined,
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitHit> {
    const client = await this.redis();
    if (!client) return this.fallback.hit(key, limit, windowMs);

    try {
      const count = await client.incr(key);
      let ttlMs = await client.pTTL(key).catch(() => windowMs);
      if (count === 1 || ttlMs < 0) {
        // First hit of the window: (re)arm the expiry. Also re-arm whenever
        // the key has no TTL — a PEXPIRE lost to a crash/reconnect between
        // INCR and PEXPIRE would otherwise lock this IP out forever, because
        // `count` keeps growing on a key that never expires.
        await client.pExpire(key, windowMs).catch(() => undefined);
        ttlMs = windowMs;
      }
      return {
        allowed: count <= limit,
        retryAfterSeconds: Math.ceil(ttlMs / 1000),
        remaining: Math.max(0, limit - count),
      };
    } catch (error) {
      this.logger.warn(
        `Redis rate limit failed (${(error as Error).message}); using in-memory for this instance`,
      );
      return this.fallback.hit(key, limit, windowMs);
    }
  }

  private async redis(): Promise<RedisClientLike | null> {
    if (!this.client) return null;
    if (this.client.isOpen) return this.client;
    if (this.attached) return null;

    try {
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), CONNECT_TIMEOUT_MS),
        ),
      ]);
      this.attached = true;
      this.logger.log(`Redis rate limiter connected (${this.url ?? "default"})`);
      return this.client;
    } catch (error) {
      this.attached = true; // avoid reconnect spam; store keeps serving in-memory
      this.logger.warn(
        `Redis unavailable (${(error as Error).message}); rate limiting in-memory for this instance`,
      );
      return null;
    }
  }
}

/** Factory helper: build the Redis-backed store, or in-memory when no URL is set. */
export function createRateLimitStore(redisUrl: string | undefined): RateLimitStore {
  if (!redisUrl) return new InMemoryRateLimitStore();
  const client: RedisClientLike = createClient({ url: redisUrl });
  return new RedisRateLimitStore(client, redisUrl);
}
