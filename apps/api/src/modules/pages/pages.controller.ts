import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Request } from "express";
import type {
  CreatePageInput,
  PageDetailResponse,
  PageListResponse,
  ReplacePagesInput,
  SaveDocumentBody,
  UpdatePageInput,
} from "@ai-mockup-studio/shared-types";
import {
  createPageSchema,
  replacePagesSchema,
  saveDocumentSchema,
  updatePageSchema,
} from "@ai-mockup-studio/validators";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { PresenceService } from "../../common/presence.service";
import { documents, pages, projects, versions } from "../../db/schema";
import {
  blankDocument,
  ensureHomePage,
  slugify,
  toPageDto,
  uniqueSlug,
  type PageRow,
} from "./pages.service";
import { isUniqueViolation } from "../../common/db-error";

@Controller("projects/:projectId/pages")
export class PagesController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly presence: PresenceService,
  ) {}

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Req() req: Request,
  ): Promise<PageListResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    await this.assertProject(projectId);
    await ensureHomePage(this.db, projectId);
    const rows = await this.db.client
      .select()
      .from(pages)
      .where(eq(pages.projectId, projectId))
      .orderBy(asc(pages.position), asc(pages.createdAt));

    const [project] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    let currentPageId = project?.currentPageId ?? null;
    if (!currentPageId || !rows.some((row) => row.id === currentPageId)) {
      currentPageId = rows[0]?.id ?? null;
      if (currentPageId) {
        await this.db.client
          .update(projects)
          .set({ currentPageId })
          .where(eq(projects.id, projectId));
      }
    }

    return {
      projectId,
      currentPageId,
      pages: rows.map((row) => toPageDto(row as PageRow)),
    };
  }

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreatePageInput,
    @Req() req: Request,
  ): Promise<PageDetailResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const parsed = createPageSchema.parse(body);
    let slug = await uniqueSlug(this.db, projectId, parsed.slug ?? parsed.name);
    const existing = await this.db.client
      .select({ position: pages.position })
      .from(pages)
      .where(eq(pages.projectId, projectId));
    const position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const document = parsed.document ?? blankDocument(parsed.name);

    // Insert both rows in one transaction so a failure can never leave an
    // orphan document without a page (see ensureHomePage determinism).
    // uniqueSlug() is read-then-insert: if a concurrent request claimed the
    // same slug first, the unique index fails the whole transaction (rolling
    // the document back too); recompute the slug and retry once instead of
    // surfacing a 500.
    let created: readonly [{ schema: unknown; updatedAt: Date; revision: number }, PageRow];
    for (let attempt = 0; ; attempt += 1) {
      try {
        created = await this.db.client.transaction(async (tx) => {
          const [newDoc] = await tx
            .insert(documents)
            .values({
              projectId,
              schemaVersion: document.schemaVersion,
              schema: document as unknown as object,
            })
            .returning();
          const [newPage] = await tx
            .insert(pages)
            .values({
              projectId,
              name: parsed.name,
              slug,
              position,
              documentId: newDoc.id,
            })
            .returning();
          return [newDoc, newPage] as const;
        });
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) {
          slug = await uniqueSlug(this.db, projectId, parsed.slug ?? parsed.name);
          continue;
        }
        throw error;
      }
    }
    const [doc, page] = created;

    return {
      projectId,
      page: toPageDto(page as PageRow),
      document: doc.schema as unknown as UiDocument,
      updatedAt: doc.updatedAt.toISOString(),
      revision: doc.revision,
    };
  }

  /** Atomic bulk replace — used by AI multi-page generation. */
  @Put()
  async replace(
    @Param("projectId") projectId: string,
    @Body() body: ReplacePagesInput,
    @Req() req: Request,
  ): Promise<PageListResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const parsed = replacePagesSchema.parse(body);
    const usedSlugs = new Set<string>();
    const prepared = parsed.pages.map((page, index) => {
      let slug = slugify(page.slug ?? page.name);
      if (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
      while (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
      usedSlugs.add(slug);
      return { ...page, slug, position: index };
    });

    await this.db.client.transaction(async (tx) => {
      await tx.delete(pages).where(eq(pages.projectId, projectId));
      await tx.delete(documents).where(eq(documents.projectId, projectId));

      let firstPageId: string | null = null;
      for (const entry of prepared) {
        const [doc] = await tx
          .insert(documents)
          .values({
            projectId,
            schemaVersion: entry.document.schemaVersion,
            schema: entry.document as unknown as object,
          })
          .returning();
        const [page] = await tx
          .insert(pages)
          .values({
            projectId,
            name: entry.name,
            slug: entry.slug,
            position: entry.position,
            documentId: doc.id,
          })
          .returning();
        firstPageId ??= page.id;
      }

      await tx
        .update(projects)
        .set({ currentPageId: firstPageId, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    });

    return this.list(projectId, req);
  }

  @Get(":pageId")
  async detail(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Req() req: Request,
  ): Promise<PageDetailResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    const page = await this.findPage(projectId, pageId);
    const [doc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);
    if (!doc) throw new NotFoundException(`Trang ${pageId} không có document`);

    return {
      projectId,
      page: toPageDto(page as PageRow),
      document: doc.schema as unknown as UiDocument,
      updatedAt: doc.updatedAt.toISOString(),
      revision: doc.revision,
    };
  }

  /** Activate a page (defined before the generic :pageId POST). */
  @Post(":pageId/activate")
  async activate(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Req() req: Request,
  ): Promise<PageListResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    const page = await this.findPage(projectId, pageId);
    await this.db.client
      .update(projects)
      .set({ currentPageId: page.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    return this.list(projectId, req);
  }

  @Post(":pageId")
  async save(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: SaveDocumentBody,
    @Req() req: Request,
  ): Promise<PageDetailResponse> {
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const parsed = saveDocumentSchema.parse(body);
    const page = await this.findPage(projectId, pageId);
    const [existing] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);
    if (!existing) throw new NotFoundException(`Trang ${pageId} không có document`);

    // Optimistic concurrency (plan/07 4.4) — identical contract to
    // documents.service.save(): baseVersion is REQUIRED for an update, and
    // the write itself is guarded by `WHERE revision = expectedBase` inside
    // one transaction with the autosave snapshot. A missing OR stale
    // baseVersion gets the same 409 shape; a writer that races past the
    // pre-check matches zero rows and also gets 409 instead of silently
    // clobbering the other save.
    const conflict = () =>
      new ConflictException({
        message:
          "Document đã được người khác cập nhật. Hãy tải bản mới nhất trước khi lưu.",
        currentVersion: String(existing.revision),
      });
    if (!parsed.baseVersion || parsed.baseVersion !== String(existing.revision)) {
      throw conflict();
    }
    const expectedBase = existing.revision;

    const saved = await this.db.client.transaction(async (tx) => {
      const [lastVersion] = await tx
        .select({ createdAt: versions.createdAt })
        .from(versions)
        .where(eq(versions.documentId, existing.id))
        .orderBy(desc(versions.createdAt))
        .limit(1);
      const shouldSnapshot =
        !lastVersion || Date.now() - lastVersion.createdAt.getTime() > 5 * 60 * 1000;
      if (shouldSnapshot) {
        await tx.insert(versions).values({
          documentId: existing.id,
          projectId: existing.projectId,
          snapshot: existing.schema as object,
          note: "Autosave",
        });
      }

      const [updated] = await tx
        .update(documents)
        .set({
          schema: parsed.document as unknown as object,
          schemaVersion: parsed.document.schemaVersion,
          revision: expectedBase + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, page.documentId),
            eq(documents.revision, expectedBase),
          ),
        )
        .returning();
      if (!updated) throw conflict();
      return updated;
    });
    const [updatedPage] = await this.db.client
      .update(pages)
      .set({ updatedAt: new Date() })
      .where(eq(pages.id, page.id))
      .returning();

    await this.db.client
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const updatedAt = saved.updatedAt.toISOString();
    this.presence.broadcastDocumentUpdate(projectId, {
      pageId: page.id,
      updatedAt,
      actor: { email: user.email },
    });

    return {
      projectId,
      page: toPageDto(updatedPage as PageRow),
      document: saved.schema as unknown as UiDocument,
      updatedAt,
      revision: saved.revision,
    };
  }

  @Patch(":pageId")
  async update(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: UpdatePageInput,
    @Req() req: Request,
  ): Promise<PageDetailResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    const parsed = updatePageSchema.parse(body);
    const page = await this.findPage(projectId, pageId);
    const desiredSlug =
      parsed.slug !== undefined
        ? parsed.slug
        : parsed.name !== undefined
          ? parsed.name
          : undefined;
    let slug =
      desiredSlug !== undefined
        ? await uniqueSlug(this.db, projectId, desiredSlug, page.id)
        : undefined;
    let updated: PageRow | undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const [row] = await this.db.client
          .update(pages)
          .set({
            ...(parsed.name !== undefined ? { name: parsed.name } : {}),
            ...(slug !== undefined ? { slug } : {}),
            ...(parsed.position !== undefined ? { position: parsed.position } : {}),
            updatedAt: new Date(),
          })
          .where(eq(pages.id, page.id))
          .returning();
        updated = row as PageRow;
        break;
      } catch (error) {
        // Slug taken between uniqueSlug()'s read and this write by a
        // concurrent rename — recompute and retry once (same race as create()).
        if (attempt === 0 && slug !== undefined && isUniqueViolation(error)) {
          slug = await uniqueSlug(this.db, projectId, desiredSlug!, page.id);
          continue;
        }
        throw error;
      }
    }

    const [doc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);
    if (!doc) {
      // Dangling pages.documentId — same guard as detail()/save().
      throw new NotFoundException(`Trang ${page.id} không có document`);
    }

    return {
      projectId,
      page: toPageDto(updated as PageRow),
      document: doc.schema as unknown as UiDocument,
      updatedAt: doc.updatedAt.toISOString(),
      revision: doc.revision,
    };
  }

  @Delete(":pageId")
  async remove(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Req() req: Request,
  ): Promise<PageListResponse> {
    await this.access.assertProjectRole(projectId, "editor", req);
    const page = await this.findPage(projectId, pageId);
    const rows = await this.db.client
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.projectId, projectId));
    if (rows.length <= 1) {
      throw new BadRequestException("Dự án phải còn ít nhất một trang");
    }

    const [project] = await this.db.client
      .select({ currentPageId: projects.currentPageId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    await this.db.client.delete(documents).where(eq(documents.id, page.documentId));

    // Deleting a background page must not steal the active page from the user.
    if (project?.currentPageId === page.id) {
      const remaining = await this.db.client
        .select({ id: pages.id })
        .from(pages)
        .where(eq(pages.projectId, projectId))
        .orderBy(asc(pages.position), asc(pages.createdAt));
      await this.db.client
        .update(projects)
        .set({ currentPageId: remaining[0]?.id ?? null, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
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

  private async findPage(projectId: string, pageId: string): Promise<PageRow> {
    const [page] = await this.db.client
      .select()
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);
    if (!page || page.projectId !== projectId) {
      throw new NotFoundException(`Trang ${pageId} không tồn tại`);
    }
    return page as PageRow;
  }
}
