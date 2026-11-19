import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

// ---------------------------------------------------------------------------
// HTTP instrumentation (plan/12 GĐ 6.4): counts/latency per route, request id
// for log correlation, and warnings for server errors / slow requests.
// ---------------------------------------------------------------------------

export function normalizeRoute(req: Request): string {
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (routePath) return routePath;
  // Unmatched paths are attacker-controlled; bucket them under one constant
  // so probing random URLs cannot grow the metrics route map.
  return ":unmatched";
}

@Injectable()
export class RequestMetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");
  private readonly slowMs = Math.max(
    0,
    Number(process.env.SLOW_REQUEST_MS ?? 750) || 750,
  );

  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = performance.now();
    const requestId =
      typeof req.headers["x-request-id"] === "string"
        ? req.headers["x-request-id"]
        : randomUUID();
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      const durationMs = performance.now() - start;
      const route = normalizeRoute(req);
      this.metrics.recordRequest(req.method, route, res.statusCode, durationMs);

      if (res.statusCode >= 500) {
        this.logger.error(
          `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Math.round(durationMs)}ms) [${requestId}]`,
        );
      } else if (durationMs >= this.slowMs) {
        this.logger.warn(
          `Slow ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Math.round(durationMs)}ms) [${requestId}]`,
        );
      }
    });

    next();
  }
}
