import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisRateLimitStore, type RedisClientLike } from "./redis-rate-limit.store";

/** Fake node-redis client. Overrides win over the default in-memory counter. */
function fakeClient(overrides: Record<string, unknown> = {}): RedisClientLike {
  const state: Record<string, number> = {};
  const client = {
    isOpen: true,
    incr: vi.fn(async (key: string) => {
      state[key] = (state[key] ?? 0) + 1;
      return state[key];
    }),
    pExpire: vi.fn(async () => "OK"),
    pTTL: vi.fn(async () => 60_000),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
  return client as unknown as RedisClientLike;
}

function mocked(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe("RedisRateLimitStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shares a counter across store instances (multi-instance behavior)", async () => {
    // Same fake client => same key space => two "instances" share the counter.
    const client = fakeClient();
    const a = new RedisRateLimitStore(client, "redis://a");
    const b = new RedisRateLimitStore(client, "redis://b");

    await a.hit("203.0.113.1", 3, 60_000);
    await a.hit("203.0.113.1", 3, 60_000);
    const third = await b.hit("203.0.113.1", 3, 60_000);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = await a.hit("203.0.113.1", 3, 60_000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("arms the key expiry on the first hit of a window", async () => {
    const client = fakeClient();
    const store = new RedisRateLimitStore(client, "redis://a");

    await store.hit("k:1", 5, 60_000);
    await store.hit("k:1", 5, 60_000);

    expect(client.incr).toHaveBeenCalledTimes(2);
    expect(client.pExpire).toHaveBeenCalledTimes(1);
    expect(client.pExpire).toHaveBeenCalledWith("k:1", 60_000);
  });

  it("falls back to in-memory when Redis throws on increment", async () => {
    const client = fakeClient();
    mocked(client.incr).mockRejectedValue(new Error("ECONNREFUSED"));
    const store = new RedisRateLimitStore(client, "redis://unreachable");

    // First call tries Redis, fails, and falls back to in-memory limiting.
    const first = await store.hit("203.0.113.9", 2, 60_000);
    expect(first.allowed).toBe(true);

    const second = await store.hit("203.0.113.9", 2, 60_000);
    expect(second.allowed).toBe(true);

    const third = await store.hit("203.0.113.9", 2, 60_000);
    expect(third.allowed).toBe(false);
  });

  it("falls back to in-memory when the client cannot connect", async () => {
    const client = fakeClient();
    mocked(client.connect).mockRejectedValue(new Error("timeout"));
    client.isOpen = false;
    const store = new RedisRateLimitStore(client, "redis://down");

    const hit = await store.hit("203.0.113.10", 2, 60_000);
    expect(hit.allowed).toBe(true);
    // The client was never used for the counter once connect failed.
    expect(client.incr).not.toHaveBeenCalled();
  });

  it("serves purely in-memory when no client is attached", async () => {
    const store = new RedisRateLimitStore(null, undefined);
    const first = await store.hit("203.0.113.11", 1, 60_000);
    const second = await store.hit("203.0.113.11", 1, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
