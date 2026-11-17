import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Request } from "express";
import type {
  CreateShareInput,
  ShareDto,
  ShareListResponse,
} from "@ai-mockup-studio/shared-types";
import { createShareSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { projects, shares } from "../../db/schema";
import {
  createShareToken,
  expiryFromDays,
  hashSharePassword,
  toShareDto,
} from "./shares.service";

/**
 * Owner-facing share management (plan/07 4.7). Links are project-scoped and
 * can be revoked at any time; revoked rows stay for audit but disappear from
 * the list and stop resolving on the public endpoint.
 */
@Controller("projects/:projectId/shares")
export class SharesController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ): Promise<ShareListResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    await this.assertProject(projectId);
    const rows = await this.db.client
      .select()
      .from(shares)
      .where(and(eq(shares.projectId, projectId), isNull(shares.revokedAt)))
      .orderBy(desc(shares.createdAt));

    return { projectId, shares: rows.map(toShareDto) };
  }

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateShareInput,
    @Req() req: Request,
  ): Promise<ShareDto> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const parsed = createShareSchema.parse(body);
    const [row] = await this.db.client
      .insert(shares)
      .values({
        projectId,
        token: createShareToken(),
        visibility: parsed.visibility,
        passwordHash:
          parsed.visibility === "private" && parsed.password
            ? hashSharePassword(parsed.password)
            : null,
        expiresAt: expiryFromDays(parsed.expiresInDays),
      })
      .returning();

    return toShareDto(row);
  }

  @Delete(":shareId")
  async revoke(
    @Param("projectId") projectId: string,
    @Param("shareId") shareId: string,
    @Req() req: Request,
  ): Promise<ShareListResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const [share] = await this.db.client
      .select()
      .from(shares)
      .where(and(eq(shares.id, shareId), eq(shares.projectId, projectId)))
      .limit(1);
    if (!share) throw new NotFoundException(`Link chia sẻ ${shareId} không tồn tại`);

    if (!share.revokedAt) {
      await this.db.client
        .update(shares)
        .set({ revokedAt: new Date() })
        .where(eq(shares.id, share.id));
    }

    return this.list(projectId, req);
  }

  private async assertProject(projectId: string): Promise<void> {
    const [project] = await this.db.client
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);
  }
}
