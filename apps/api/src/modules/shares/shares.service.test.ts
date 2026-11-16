import { describe, expect, it } from "vitest";
import { createShareSchema } from "@ai-mockup-studio/validators";
import {
  createShareToken,
  expiryFromDays,
  hashSharePassword,
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
  it("hashes with a random salt and verifies the right password", () => {
    const first = hashSharePassword("mat-khau-123");
    const second = hashSharePassword("mat-khau-123");
    expect(first).not.toBe(second);
    expect(first.startsWith("scrypt$")).toBe(true);
    expect(first).not.toContain("mat-khau-123");
    expect(verifySharePassword("mat-khau-123", first)).toBe(true);
    expect(verifySharePassword("mat-khau-123", second)).toBe(true);
  });

  it("rejects wrong passwords and malformed hashes", () => {
    const stored = hashSharePassword("dung-roi");
    expect(verifySharePassword("sai-roi", stored)).toBe(false);
    expect(verifySharePassword("dung-roi", "")).toBe(false);
    expect(verifySharePassword("dung-roi", "bcrypt$abc$def")).toBe(false);
    expect(verifySharePassword("dung-roi", "scrypt$$")).toBe(false);
    expect(verifySharePassword("dung-roi", "scrypt$salt$zzzz")).toBe(false);
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
