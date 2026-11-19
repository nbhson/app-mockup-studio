import { describe, expect, it } from "vitest";
import { resolveTrustProxy } from "./trust-proxy";

describe("resolveTrustProxy", () => {
  it("trusts nothing when TRUST_PROXY is unset, empty or whitespace", () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy("")).toBe(false);
    expect(resolveTrustProxy("   ")).toBe(false);
  });

  it('"true" trusts exactly one immediate proxy hop', () => {
    expect(resolveTrustProxy("true")).toBe(1);
    expect(resolveTrustProxy("TRUE")).toBe(1);
  });

  it("a positive integer trusts that many leading hops", () => {
    expect(resolveTrustProxy("2")).toBe(2);
    expect(resolveTrustProxy(" 3 ")).toBe(3);
  });

  it("rejects garbage, zero and negative values instead of enabling trust", () => {
    // "0"/negative/float/`trust all` strings must NOT map to a truthy value:
    // `true` in Express trusts the ENTIRE XFF chain (spoofable client IPs).
    expect(resolveTrustProxy("0")).toBe(false);
    expect(resolveTrustProxy("-1")).toBe(false);
    expect(resolveTrustProxy("1.5")).toBe(false);
    expect(resolveTrustProxy("yes")).toBe(false);
  });
});
