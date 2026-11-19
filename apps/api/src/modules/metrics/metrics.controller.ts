import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { MetricsService, type MetricsSnapshot } from "../../common/metrics.service";

/**
 * Constant-time token comparison. `!==` leaks the token through timing
 * (byte-by-byte early exit on a very long string), and this endpoint exposes
 * request counts and latencies — worth not guessing at.
 */
function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Length mismatch is not secret material; bail before timingSafeEqual,
  // which throws for unequal lengths.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * JSON snapshot for dashboards/alerts. Set METRICS_TOKEN to require
   * `Authorization: Bearer <token>` in production.
   */
  @Get()
  getMetrics(
    @Headers("authorization") authorization?: string,
    @Headers("x-metrics-token") token?: string,
  ): MetricsSnapshot {
    const expected = process.env.METRICS_TOKEN;
    if (expected) {
      const bearer = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      if (!tokenMatches(bearer, expected) && !tokenMatches(token, expected)) {
        throw new UnauthorizedException("Invalid metrics token");
      }
    }
    return this.metrics.snapshot();
  }
}
