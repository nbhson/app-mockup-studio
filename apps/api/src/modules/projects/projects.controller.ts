import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
  Req,
} from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import type {
  ProjectDto,
  CreateProjectInput,
  UpdateProjectInput,
} from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { createProjectSchema, transferProjectSchema, updateProjectSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { projects, documents, pages, assets, projectMembers, organizations } from "../../db/schema";
import { remapAssetUrls } from "./duplicate-document";

function toDto(row: {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  designSystemId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    organizationId: row.organizationId ?? null,
    designSystemId: row.designSystemId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@Req() req: Request): Promise<ProjectDto[]> {
    const user = await this.access.resolve(req);
    if (!user) return [];
    // Owned projects + projects the user is explicitly a member of + projects
    // shared via the user's organizations (plan/07 4.11).
    const memberRows = await this.db.client
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, user.id));
    const sharedIds = memberRows.map((r) => r.projectId);
    const orgIds = await this.access.userOrganizationIds(user.id);
    const orgProjectRows =
      orgIds.length > 0
        ? await this.db.client
            .select()
            .from(projects)
            .where(
              inArray(projects.organizationId, orgIds),
            )
        : [];

    const owned = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.ownerId, user.id));

    const sharedRows =
      sharedIds.length > 0
        ? await this.db.client
            .select()
            .from(projects)
            .where(inArray(projects.id, sharedIds))
        : [];

    const byId = new Map<string, ProjectDto>();
    for (const row of [...owned, ...sharedRows, ...orgProjectRows]) {
      byId.set(row.id, toDto(row));
    }
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  @Post()
  async create(
    @Body() body: CreateProjectInput,
    @Req() req: Request,
  ): Promise<ProjectDto> {
    const parsed = createProjectSchema.parse(body);
    const user = await this.access.resolve(req);
    if (!user) {
      throw new NotFoundException("Demo user chưa tồn tại — chạy `pnpm db:push && pnpm db:seed`");
    }
    const [row] = await this.db.client
      .insert(projects)
      .values({
        name: parsed.name,
        description: parsed.description ?? null,
        ownerId: user.id,
      })
      .returning();
    return toDto(row);
  }

  @Get(":id")
  async get(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<ProjectDto> {
    await this.access.assertProjectRole(id, "viewer", req);
    const [row] = await this.db.client.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException(`Dự án ${id} không tồn tại`);
    return toDto(row);
  }

  @Post(":id/duplicate")
  async duplicate(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<ProjectDto> {
    await this.access.assertProjectRole(id, "editor", req);
    const [source] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!source) throw new NotFoundException(`Dự án ${id} không tồn tại`);

    const [copy] = await this.db.client
      .insert(projects)
      .values({
        name: `${source.name} (bản sao)`,
        description: source.description,
        ownerId: source.ownerId,
        designSystemId: source.designSystemId,
      })
      .returning();

    // Assets are project-scoped, so the duplicate needs its own rows; the
    // document's image URLs are rewritten to the copied asset ids below.
    const sourceAssets = await this.db.client
      .select()
      .from(assets)
      .where(eq(assets.projectId, id));
    const urlMap = new Map<string, string>();
    for (const asset of sourceAssets) {
      const [assetCopy] = await this.db.client
        .insert(assets)
        .values({
          projectId: copy.id,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          size: asset.size,
          data: asset.data,
        })
        .returning({ id: assets.id });
      urlMap.set(
        `/api/projects/${id}/assets/${asset.id}/raw`,
        `/api/projects/${copy.id}/assets/${assetCopy.id}/raw`,
      );
    }

    const sourcePages = await this.db.client
      .select()
      .from(pages)
      .where(eq(pages.projectId, id))
      .orderBy(asc(pages.position), asc(pages.createdAt));

    const pageIdMap = new Map<string, string>();
    if (sourcePages.length > 0) {
      for (const sourcePage of sourcePages) {
        const [sourceDoc] = await this.db.client
          .select()
          .from(documents)
          .where(eq(documents.id, sourcePage.documentId))
          .limit(1);
        if (!sourceDoc) continue;
        const schema = remapAssetUrls(
          sourceDoc.schema as unknown as UiDocument,
          urlMap,
        );
        const [docCopy] = await this.db.client
          .insert(documents)
          .values({
            projectId: copy.id,
            schemaVersion: sourceDoc.schemaVersion,
            schema,
          })
          .returning();
        const [pageCopy] = await this.db.client
          .insert(pages)
          .values({
            projectId: copy.id,
            name: sourcePage.name,
            slug: sourcePage.slug,
            position: sourcePage.position,
            documentId: docCopy.id,
          })
          .returning();
        pageIdMap.set(sourcePage.id, pageCopy.id);
      }
    } else {
      // Legacy project without pages: copy the document and wrap it in a page.
      const [sourceDoc] = await this.db.client
        .select()
        .from(documents)
        .where(eq(documents.projectId, id))
        .limit(1);
      if (sourceDoc) {
        const schema = remapAssetUrls(
          sourceDoc.schema as unknown as UiDocument,
          urlMap,
        );
        const [docCopy] = await this.db.client
          .insert(documents)
          .values({
            projectId: copy.id,
            schemaVersion: sourceDoc.schemaVersion,
            schema,
          })
          .returning();
        const [pageCopy] = await this.db.client
          .insert(pages)
          .values({
            projectId: copy.id,
            name: (schema as UiDocument).name?.trim() || "Home",
            slug: "home",
            position: 0,
            documentId: docCopy.id,
          })
          .returning();
        pageIdMap.set("legacy", pageCopy.id);
      }
    }

    const mappedCurrent =
      (source.currentPageId && pageIdMap.get(source.currentPageId)) ||
      [...pageIdMap.values()][0] ||
      null;
    if (mappedCurrent) {
      await this.db.client
        .update(projects)
        .set({ currentPageId: mappedCurrent })
        .where(eq(projects.id, copy.id));
    }

    return toDto(copy);
  }

  @Post(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateProjectInput,
    @Req() req: Request,
  ): Promise<ProjectDto> {
    await this.access.assertProjectRole(id, "editor", req);
    const parsed = updateProjectSchema.parse(body);
    const [row] = await this.db.client
      .update(projects)
      .set({ name: parsed.name, description: parsed.description ?? null, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Dự án ${id} không tồn tại`);
    return toDto(row);
  }

  /**
   * Transfer the project to an organization workspace (plan/07 4.11). Only the
   * project owner can do this. `organizationId: null` returns the project to a
   * personal project.
   */
  @Post(":id/organization")
  async transfer(
    @Param("id") id: string,
    @Body() body: { organizationId: string | null },
    @Req() req: Request,
  ): Promise<ProjectDto> {
    await this.access.assertProjectRole(id, "owner", req);
    const parsed = transferProjectSchema.parse(body);

    if (parsed.organizationId !== null) {
      // Verify the target org exists and the user has admin/owner access.
      await this.access.assertOrgRole(parsed.organizationId, "admin", req);
      const [org] = await this.db.client
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, parsed.organizationId))
        .limit(1);
      if (!org) throw new NotFoundException(`Tổ chức ${parsed.organizationId} không tồn tại.`);
    }

    const [row] = await this.db.client
      .update(projects)
      .set({ organizationId: parsed.organizationId, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Dự án ${id} không tồn tại.`);
    return toDto(row);
  }

  @Delete(":id")
  async remove(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ ok: boolean }> {
    await this.access.assertProjectRole(id, "owner", req);
    await this.db.client.delete(documents).where(eq(documents.projectId, id));
    await this.db.client.delete(projectMembers).where(eq(projectMembers.projectId, id));
    await this.db.client.delete(projects).where(eq(projects.id, id));
    return { ok: true };
  }
}
