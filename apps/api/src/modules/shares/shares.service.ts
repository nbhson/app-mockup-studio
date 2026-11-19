// ---------------------------------------------------------------------------
// Share helpers (plan/07 4.7 — public/private preview links).
//
// Tokens are unguessable URL-safe random strings. Private links store a scrypt
// hash (never the password) and are verified with a timing-safe comparison.
//
// scrypt is intentionally ASYNC (`crypto.scrypt`, not `scryptSync`): a single
// sync hash blocks the whole event loop for ~100ms, so a handful of concurrent
// share views would stall every other request. Async scrypt runs on libuv's
// thread pool and lets us keep the cost high enough to deter brute force.
// ---------------------------------------------------------------------------

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { ShareDto } from "@ai-mockup-studio/shared-types";
import type { ShareRow } from "../../db/schema";

const scryptAsync = promisify(scrypt);

const SCRYPT_KEYLEN = 64;

/** 24-char URL-safe token (144 bits of entropy). */
export function createShareToken(): string {
  return randomBytes(18).toString("base64url");
}

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

export async function verifySharePassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// --- Brute-force throttle --------------------------------------------------

/** Failed-password budget: 10 attempts per share token per 15-minute window. */
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export interface PasswordAttemptBudget {
  allowed: boolean;
  /** Seconds until the oldest failure ages out (0 when allowed). */
  retryAfterSeconds: number;
}

/**
 * Per-share-token counter of FAILED password attempts. A wrong password on a
 * private link used to be re-tried forever at the CPU budget scrypt allows;
 * now 10 failures inside 15 minutes lock that token out (429 + Retry-After)
 * regardless of source IP, while a correct password clears the window. Public
 * (no-password) links never touch this limiter.
 *
 * Sliding window: we store each failure timestamp and drop ones that have
 * aged out, so an attacker cannot simply wait for a minute boundary to get a
 * fresh budget of ten.
 */
export class SharePasswordThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts = MAX_FAILED_ATTEMPTS,
    private readonly windowMs = WINDOW_MS,
  ) {}

  /** True when the token has exhausted its failed-attempt budget. */
  check(token: string, now = Date.now()): PasswordAttemptBudget {
    const recent = this.recentFailures(token, now);
    if (recent.length >= this.maxAttempts) {
      const oldest = recent[0];
      const retryMs = oldest + this.windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Record one failed password attempt for the token. */
  recordFailure(token: string, now = Date.now()): void {
    const recent = this.recentFailures(token, now);
    recent.push(now);
    this.failures.set(token, recent);
  }

  /** Clear the window after a successful unlock. */
  reset(token: string): void {
    this.failures.delete(token);
  }

  private recentFailures(token: string, now: number): number[] {
    const existing = this.failures.get(token);
    if (!existing) return [];
    const recent = existing.filter((time) => now - time < this.windowMs);
    if (recent.length === 0) this.failures.delete(token);
    else if (recent.length !== existing.length) this.failures.set(token, recent);
    return recent;
  }
}

/** Shared process-wide throttle (per-instance in dev; Redis for multi-node). */
export const sharePasswordThrottle = new SharePasswordThrottle();

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
