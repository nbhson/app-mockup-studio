// ---------------------------------------------------------------------------
// Express "trust proxy" configuration (rate limiting behind a reverse proxy).
//
// Without `trust proxy`, Express reports the load balancer's address as every
// request's IP, so IP-scoped rate limits collapse into a single shared bucket
// (and real client IPs are invisible). Enabling it blindly is dangerous,
// though: if the app is reachable directly, an attacker can spoof
// `X-Forwarded-For`. So we only trust a bounded number of leading proxies,
// configured via the TRUST_PROXY env var and never on by default.
// ---------------------------------------------------------------------------

/**
 * Parse the `TRUST_PROXY` value into an Express `trust proxy` setting.
 * - unset / empty / invalid → `false` (trust nothing; safe dev default)
 * - "true"                  → trust exactly 1 immediate proxy hop
 * - a positive integer      → trust that many leading hops (e.g. "2")
 *
 * Express semantics: `app.set('trust proxy', n)` trusts the `n` outermost
 * `X-Forwarded-For` entries.
 */
export function resolveTrustProxy(value: string | undefined): number | false {
  const raw = value?.trim().toLowerCase();
  if (!raw) return false;
  if (raw === "true") return 1;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 1) return hops;
  return false;
}
