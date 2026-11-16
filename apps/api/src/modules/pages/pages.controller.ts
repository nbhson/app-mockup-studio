import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
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
import { documents, pages, projects, versions } from "../../db/schema";
import {
  blankDocument,
  ensureHomePage,
  slugify,
  toPageDto,
  uniqueSlug,
  type PageRow,
} from "./pages.service";

@Controller("projects/:projectId/pages")
export class PagesController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Param("projectId") projectId: string): Promise<PageListResponse> {
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
  ): Promise<PageDetailResponse> {
    await this.assertProject(projectId);
    const parsed = createPageSchema.parse(body);
    const slug = await uniqueSlug(this.db, projectId, parsed.slug ?? parsed.name);
    const existing = await this.db.client
      .select({ position: pages.position })
      .from(pages)
      .where(eq(pages.projectId, projectId));
    const position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const document = parsed.document ?? blankDocument(parsed.name);

    const [doc] = await this.db.client
      .insert(documents)
      .values({
        projectId,
        schemaVersion: document.schemaVersion,
        schema: document as unknown as object,
      })
      .returning();
    const [page] = await this.db.client
      .insert(pages)
      .values({
        projectId,
        name: parsed.name,
        slug,
        position,
        documentId: doc.id,
      })
      .returning();

    return {
      projectId,
      page: toPageDto(page as PageRow),
      document: doc.schema as unknown as UiDocument,
    };
  }

  /** Atomic bulk replace — used by AI multi-page generation. */
  @Put()
  async replace(
    @Param("projectId") projectId: string,
    @Body() body: ReplacePagesInput,
  ): Promise<PageListResponse> {
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

    return this.list(projectId);
  }

  @Get(":pageId")
  async detail(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
  ): Promise<PageDetailResponse> {
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
    };
  }

  /** Activate a page (defined before the generic :pageId POST). */
  @Post(":pageId/activate")
  async activate(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
  ): Promise<PageListResponse> {
    const page = await this.findPage(projectId, pageId);
    await this.db.client
      .update(projects)
      .set({ currentPageId: page.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    return this.list(projectId);
  }

  @Post(":pageId")
  async save(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: SaveDocumentBody,
  ): Promise<PageDetailResponse> {
    const parsed = saveDocumentSchema.parse(body);
    const page = await this.findPage(projectId, pageId);
    const [existing] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);

    if (existing) {
      const [lastVersion] = await this.db.client
        .select({ createdAt: versions.createdAt })
        .from(versions)
        .where(eq(versions.documentId, existing.id))
        .orderBy(desc(versions.createdAt))
        .limit(1);
      const shouldSnapshot =
        !lastVersion || Date.now() - lastVersion.createdAt.getTime() > 5 * 60 * 1000;
      if (shouldSnapshot) {
        await this.db.client.insert(versions).values({
          documentId: existing.id,
          snapshot: existing.schema as object,
          note: "Autosave",
        });
      }
    }

    const [saved] = await this.db.client
      .update(documents)
      .set({
        schema: parsed.document as unknown as object,
        schemaVersion: parsed.document.schemaVersion,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, page.documentId))
      .returning();
    const [updatedPage] = await this.db.client
      .update(pages)
      .set({ updatedAt: new Date() })
      .where(eq(pages.id, page.id))
      .returning();

    await this.db.client
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return {
      projectId,
      page: toPageDto(updatedPage as PageRow),
      document: saved.schema as unknown as UiDocument,
    };
  }

  @Patch(":pageId")
  async update(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
    @Body() body: UpdatePageInput,
  ): Promise<PageDetailResponse> {
    const parsed = updatePageSchema.parse(body);
    const page = await this.findPage(projectId, pageId);
    const slug =
      parsed.slug !== undefined
        ? await uniqueSlug(this.db, projectId, parsed.slug, page.id)
        : parsed.name !== undefined
          ? await uniqueSlug(this.db, projectId, parsed.name, page.id)
          : undefined;
    const [updated] = await this.db.client
      .update(pages)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(parsed.position !== undefined ? { position: parsed.position } : {}),
        updatedAt: new Date(),
      })
      .where(eq(pages.id, page.id))
      .returning();

    const [doc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);

    return {
      projectId,
      page: toPageDto(updated as PageRow),
      document: doc.schema as unknown as UiDocument,
    };
  }

  @Delete(":pageId")
  async remove(
    @Param("projectId") projectId: string,
    @Param("pageId") pageId: string,
  ): Promise<PageListResponse> {
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

    return this.list(projectId);
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
