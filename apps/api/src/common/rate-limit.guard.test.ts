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

  it("allows requests up to the limit, then returns 429", () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor("203.0.113.7");

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);

    try {
      guard.canActivate(context);
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

  it("resets the bucket after the one-minute window", () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor("203.0.113.8");

    guard.canActivate(context);
    guard.canActivate(context);
    guard.canActivate(context);
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    vi.advanceTimersByTime(60_001);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("isolates clients by IP", () => {
    const guard = new AiRateLimitGuard();
    const first = contextFor("203.0.113.10");
    const second = contextFor("203.0.113.11");

    guard.canActivate(first);
    guard.canActivate(first);
    guard.canActivate(first);
    expect(() => guard.canActivate(first)).toThrow(HttpException);

    expect(guard.canActivate(second)).toBe(true);
  });

  it("falls back to the socket address when ip is unavailable", () => {
    const guard = new AiRateLimitGuard();
    const context = contextFor(undefined, "192.0.2.44");

    for (let index = 0; index < 3; index += 1) {
      expect(guard.canActivate(context)).toBe(true);
    }
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });
});
