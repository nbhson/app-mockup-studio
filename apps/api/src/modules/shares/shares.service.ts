// ---------------------------------------------------------------------------
// Share helpers (plan/07 4.7 — public/private preview links).
//
// Tokens are unguessable URL-safe random strings. Private links store a scrypt
// hash (never the password) and are verified with a timing-safe comparison.
// ---------------------------------------------------------------------------

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ShareDto } from "@ai-mockup-studio/shared-types";
import type { ShareRow } from "../../db/schema";

const SCRYPT_KEYLEN = 64;

/** 24-char URL-safe token (144 bits of entropy). */
export function createShareToken(): string {
  return randomBytes(18).toString("base64url");
}

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** `expiresInDays` omitted/null → link never expires. */
export function expiryFromDays(days: number | null | undefined): Date | null {
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function toShareDto(row: ShareRow): ShareDto {
  return {
    id: row.id,
    token: row.token,
    visibility: row.visibility === "private" ? "private" : "public",
    hasPassword: Boolean(row.passwordHash),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    path: `/share/${row.token}`,
  };
}
