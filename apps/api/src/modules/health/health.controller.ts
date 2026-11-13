import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import type { HealthResponse } from "@ai-mockup-studio/shared-types";
import { DbService } from "../../db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Readiness probe: verifies the database with a cheap query and returns 503
   * while degraded so orchestrators/alerting can react.
   */
  @Get()
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    let database: "up" | "down" = "up";
    try {
      await this.db.raw.query("SELECT 1");
    } catch {
      database = "down";
    }

    const status = database === "up" ? "ok" : "degraded";
    if (status === "degraded") res.status(503);

    return {
      status,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database },
      version: process.env.APP_VERSION ?? "0.1.0",
    };
  }
}
