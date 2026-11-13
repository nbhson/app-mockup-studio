import { HttpException, type ExecutionContext } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRateLimitGuard } from "./rate-limit.guard";

function contextFor(ip: string | undefined, remoteAddress = "10.0.0.1"): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress } }),
    }),
  } as unknown as ExecutionContext;
}

describe("AiRateLimitGuard", () => {
  const originalLimit = process.env.AI_RATE_LIMIT;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env.AI_RATE_LIMIT = "3";
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalLimit === undefined) delete process.env.AI_RATE_LIMIT;
    else process.env.AI_RATE_LIMIT = originalLimit;
  });

  it("allows requests up to the limit, then returns 429", async () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor("203.0.113.7");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    try {
      await guard.canActivate(context);
      throw new Error("expected the guard to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(429);
      expect(exception.getResponse()).toMatchObject({
        message: expect.stringContaining("Quá nhiều yêu cầu AI"),
      });
    }
  });

  it("resets the bucket after the one-minute window", async () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor("203.0.113.8");

    await guard.canActivate(context);
    await guard.canActivate(context);
    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

    vi.advanceTimersByTime(60_001);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("isolates clients by IP", async () => {
    const guard = new AiRateLimitGuard();
    const first = contextFor("203.0.113.10");
    const second = contextFor("203.0.113.11");

    await guard.canActivate(first);
    await guard.canActivate(first);
    await guard.canActivate(first);
    await expect(guard.canActivate(first)).rejects.toThrow(HttpException);

    await expect(guard.canActivate(second)).resolves.toBe(true);
  });

  it("falls back to the socket address when ip is unavailable", async () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor(undefined, "192.0.2.44");

    for (let index = 0; index < 3; index += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });

  it("uses an injected Redis-like store when provided", async () => {
    let calls = 0;
    const store = {
      hit: async () => {
        calls += 1;
        const allowed = calls <= 2;
        return { allowed, retryAfterSeconds: 42, remaining: 0 };
      },
    } as never;
    const guard = new AiRateLimitGuard(store as never);
    const context = contextFor("203.0.113.20");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    const exception = (await guard.canActivate(context).catch((error) => error)) as HttpException;
    expect(exception.getResponse()).toMatchObject({ message: expect.stringContaining("42 giây") });
  });
});
