import { describe, expect, it } from "vitest";
import { createShareSchema } from "@ai-mockup-studio/validators";
import {
  createShareToken,
  expiryFromDays,
  hashSharePassword,
  SharePasswordThrottle,
  verifySharePassword,
} from "./shares.service";

describe("share tokens", () => {
  it("creates unique URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, createShareToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });
});

describe("share passwords", () => {
  it("hashes with a random salt and verifies the right password", async () => {
    const first = await hashSharePassword("mat-khau-123");
    const second = await hashSharePassword("mat-khau-123");
    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$")).toBe(true);
    expect(first).not.toContain("mat-khau-123");
    expect(await verifySharePassword("mat-khau-123", first)).toBe(true);
    expect(await verifySharePassword("mat-khau-123", second)).toBe(true);
  });

  it("rejects wrong passwords and malformed hashes", async () => {
    const stored = await hashSharePassword("dung-roi");
    expect(await verifySharePassword("sai-roi", stored)).toBe(false);
    expect(await verifySharePassword("dung-roi", "")).toBe(false);
    expect(await verifySharePassword("dung-roi", "bcrypt$abc$def")).toBe(false);
    expect(await verifySharePassword("dung-roi", "scrypt$$")).toBe(false);
    expect(await verifySharePassword("dung-roi", "scrypt$salt$zzzz")).toBe(false);
  });

  it("is async so it never blocks the event loop with scryptSync", () => {
    // A decommissioned scryptSync would return the string/boolean directly;
    // the promisified crypto.scrypt must return a Promise instead.
    expect(hashSharePassword("x")).toBeInstanceOf(Promise);
  });
});

describe("SharePasswordThrottle", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("allows 10 failures then locks the token out with a Retry-After", () => {
    const throttle = new SharePasswordThrottle();
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) {
      expect(throttle.check("tok", now).allowed).toBe(true);
      throttle.recordFailure("tok", now);
    }
    const blocked = throttle.check("tok", now);
    expect(blocked.allowed).toBe(false);
    // 15-minute window minus the elapsed time.
    expect(blocked.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("scopes the budget per token and clears it on success", () => {
    const throttle = new SharePasswordThrottle();
    const now = Date.now();
    for (let index = 0; index < 10; index += 1) throttle.recordFailure("a", now);
    expect(throttle.check("a", now).allowed).toBe(false);
    expect(throttle.check("b", now).allowed).toBe(true);

    throttle.reset("a");
    expect(throttle.check("a", now).allowed).toBe(true);
  });

  it("ages failures out of the sliding window after 15 minutes", () => {
    const throttle = new SharePasswordThrottle();
    const start = Date.now();
    for (let index = 0; index < 10; index += 1) throttle.recordFailure("tok", start);
    expect(throttle.check("tok", start).allowed).toBe(false);
    expect(throttle.check("tok", start + 15 * 60 * 1000 + 1).allowed).toBe(true);
    expect(throttle.check("tok", start - DAY).allowed).toBe(true);
  });
});

describe("share expiry", () => {
  it("returns null when the link never expires", () => {
    expect(expiryFromDays(undefined)).toBeNull();
    expect(expiryFromDays(null)).toBeNull();
    expect(expiryFromDays(0)).toBeNull();
  });

  it("converts days to a future timestamp", () => {
    const expires = expiryFromDays(7);
    expect(expires).not.toBeNull();
    const days = (expires!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });
});

describe("createShareSchema", () => {
  it("requires a password for private links", () => {
    expect(
      createShareSchema.safeParse({ visibility: "private" }).success,
    ).toBe(false);
    expect(
      createShareSchema.safeParse({ visibility: "private", password: "123" })
        .success,
    ).toBe(false);
    expect(
      createShareSchema.safeParse({ visibility: "private", password: "1234" })
        .success,
    ).toBe(true);
  });

  it("does not require a password for public links", () => {
    expect(createShareSchema.safeParse({ visibility: "public" }).success).toBe(
      true,
    );
  });

  it("bounds the expiry to 1–365 days", () => {
    expect(
      createShareSchema.safeParse({
        visibility: "public",
        expiresInDays: 0,
      }).success,
    ).toBe(false);
    expect(
      createShareSchema.safeParse({
        visibility: "public",
        expiresInDays: 30,
      }).success,
    ).toBe(true);
    expect(
      createShareSchema.safeParse({
        visibility: "public",
        expiresInDays: 400,
      }).success,
    ).toBe(false);
  });
});
