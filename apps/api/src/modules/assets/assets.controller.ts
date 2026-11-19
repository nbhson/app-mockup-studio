import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type {
  AssetDto,
  AssetListResponse,
  UploadAssetBody,
} from "@ai-mockup-studio/shared-types";
import { uploadAssetSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { assets, projects } from "../../db/schema";
import { validateAssetData } from "./asset-validation";

function toDto(
  row: {
    id: string;
    projectId: string;
    fileName: string;
    mimeType: string;
    size: number;
    createdAt: Date;
  },
  projectId: string,
): AssetDto {
  return {
    id: row.id,
    projectId: row.projectId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    url: `/api/projects/${projectId}/assets/${row.id}/raw`,
    createdAt: row.createdAt.toISOString(),
  };
}

@Controller("projects/:projectId/assets")
export class AssetsController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ): Promise<AssetListResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    await this.assertProject(projectId);
    const rows = await this.db.client
      .select({
        id: assets.id,
        projectId: assets.projectId,
        fileName: assets.fileName,
        mimeType: assets.mimeType,
        size: assets.size,
        createdAt: assets.createdAt,
      })
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(desc(assets.createdAt));

    return { projectId, assets: rows.map((row) => toDto(row, projectId)) };
  }

  @Post()
  async upload(
    @Param("projectId") projectId: string,
    @Body() body: UploadAssetBody,
    @Req() req: Request,
  ): Promise<AssetDto> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const parsed = uploadAssetSchema.parse(body);
    const data = validateAssetData(parsed.dataBase64, parsed.mimeType);

    const [row] = await this.db.client
      .insert(assets)
      .values({
        projectId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        size: data.length,
        data: data.toString("base64"),
      })
      .returning();

    return toDto(row, projectId);
  }

  @Get(":assetId/raw")
  async raw(
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    const asset = await this.findAsset(projectId, assetId);
    const data = Buffer.from(asset.data, "base64");

    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Length", data.length);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asset.fileName.replace(/["\\]/g, "")}"`,
    );
    res.end(data);
  }

  @Delete(":assetId")
  async remove(
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    // Scope the delete by BOTH project and asset id: an editor of one project
    // must not destroy another project's asset (the row used to be deleted
    // before the ownership check, turning a cross-tenant DELETE into a no-op
    // 404 on an already-dead row).
    const deleted = await this.db.client
      .delete(assets)
      .where(and(eq(assets.projectId, projectId), eq(assets.id, assetId)))
      .returning({ id: assets.id, projectId: assets.projectId });

    if (deleted.length === 0) {
      throw new NotFoundException(`Ảnh ${assetId} không tồn tại`);
    }
    return { ok: true };
  }

  private async assertProject(projectId: string): Promise<void> {
    const [project] = await this.db.client
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);
  }

  private async findAsset(projectId: string, assetId: string) {
    const [asset] = await this.db.client
      .select()
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);
    if (!asset || asset.projectId !== projectId) {
      throw new NotFoundException(`Ảnh ${assetId} không tồn tại`);
    }
    return asset;
  }
}
