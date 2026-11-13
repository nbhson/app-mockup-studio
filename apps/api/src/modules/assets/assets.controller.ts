import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { desc, eq } from "drizzle-orm";
import type {
  AssetDto,
  AssetListResponse,
  UploadAssetBody,
} from "@ai-mockup-studio/shared-types";
import { uploadAssetSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { assets, projects } from "../../db/schema";

/** 2 MiB — generous for mockups while keeping JSON bodies reasonable. */
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * Magic-byte signatures. Validating the decoded bytes (not just the declared
 * MIME type) means a renamed script/HTML file can never be served back as an
 * image. SVG is intentionally unsupported: it can carry executable script.
 */
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  ],
};

function matchesSignature(data: Buffer, mimeType: string): boolean {
  const rules = MAGIC_BYTES[mimeType];
  if (!rules) return false;
  return rules.every((rule) =>
    rule.bytes.every((byte, index) => data[rule.offset + index] === byte),
  );
}

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
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Param("projectId") projectId: string): Promise<AssetListResponse> {
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
  ): Promise<AssetDto> {
    await this.assertProject(projectId);
    const parsed = uploadAssetSchema.parse(body);

    // Accept (and strip) a data: URL prefix so clients can pass FileReader
    // output directly without extra parsing.
    const base64 = parsed.dataBase64.replace(/^data:[^;]+;base64,/, "");
    const data = Buffer.from(base64, "base64");

    if (data.length === 0) {
      throw new BadRequestException("Tệp rỗng hoặc không phải base64 hợp lệ");
    }
    if (data.length > MAX_ASSET_BYTES) {
      throw new BadRequestException(
        `Tệp vượt quá giới hạn ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB`,
      );
    }
    if (!matchesSignature(data, parsed.mimeType)) {
      throw new BadRequestException(
        "Nội dung tệp không khớp định dạng ảnh đã khai báo",
      );
    }

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
    @Res() res: Response,
  ): Promise<void> {
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
  ): Promise<{ ok: boolean }> {
    await this.assertProject(projectId);
    const deleted = await this.db.client
      .delete(assets)
      .where(eq(assets.id, assetId))
      .returning({ id: assets.id, projectId: assets.projectId });

    if (deleted.length === 0 || deleted[0].projectId !== projectId) {
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
