import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from "@nestjs/common";
import { MetricsService, type MetricsSnapshot } from "../../common/metrics.service";

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
      if (bearer !== expected && token !== expected) {
        throw new UnauthorizedException("Invalid metrics token");
      }
    }
    return this.metrics.snapshot();
  }
}
