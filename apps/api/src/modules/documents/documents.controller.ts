import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Body,
} from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type { DocumentResponse, SaveDocumentBody } from "@ai-mockup-studio/shared-types";
import { saveDocumentSchema } from "@ai-mockup-studio/validators";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { projects, documents, pages, versions } from "../../db/schema";
import { ensureHomePage, uniqueSlug } from "../pages/pages.service";

/**
 * Legacy single-document endpoints. They always operate on the project's
 * ACTIVE page, so the existing web store and clients keep working while the
 * project can hold many pages (plan/07 3.4).
 */
@Controller("projects/:projectId/document")
export class DocumentsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async get(@Param("projectId") projectId: string): Promise<DocumentResponse> {
    const [project] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);

    const page = await this.resolvePage(projectId, project.currentPageId);
    if (!page) {
      return {
        projectId,
        currentPageId: "",
        document: null,
        updatedAt: project.updatedAt.toISOString(),
      };
    }

    const [doc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, page.documentId))
      .limit(1);

    return {
      projectId,
      currentPageId: page.id,
      document: (doc?.schema as unknown as UiDocument | undefined) ?? null,
      updatedAt: (doc?.updatedAt ?? project.updatedAt).toISOString(),
    };
  }

  @Post()
  async save(
    @Param("projectId") projectId: string,
    @Body() body: SaveDocumentBody,
  ): Promise<DocumentResponse> {
    const parsed = saveDocumentSchema.parse(body);
    const [project] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);

    let page = await this.resolvePage(projectId, project.currentPageId);

    if (!page) {
      const [doc] = await this.db.client
        .insert(documents)
        .values({
          projectId,
          schemaVersion: parsed.document.schemaVersion,
          schema: parsed.document as unknown as object,
        })
        .returning();
      const slug = await uniqueSlug(this.db, projectId, "home");
      const [created] = await this.db.client
        .insert(pages)
        .values({
          projectId,
          name: parsed.document.name?.trim() || "Home",
          slug,
          position: 0,
          documentId: doc.id,
        })
        .returning();
      page = created;
    } else {
      const [existing] = await this.db.client
        .select()
        .from(documents)
        .where(eq(documents.id, page.documentId))
        .limit(1);

      // Before overwriting, keep an immutable snapshot in history (plan/10
      // versions). Autosave can fire every few seconds, so throttle snapshots
      // to one per 5 minutes.
      if (existing) {
        const [lastVersion] = await this.db.client
          .select({ createdAt: versions.createdAt })
          .from(versions)
          .where(eq(versions.documentId, existing.id))
          .orderBy(desc(versions.createdAt))
          .limit(1);
        const snapshotIntervalMs = 5 * 60 * 1000;
        const shouldSnapshot =
          !lastVersion ||
          Date.now() - lastVersion.createdAt.getTime() > snapshotIntervalMs;

        if (shouldSnapshot) {
          await this.db.client.insert(versions).values({
            documentId: existing.id,
            snapshot: existing.schema as object,
            note: "Autosave",
          });
        }
      }

      await this.db.client
        .update(documents)
        .set({
          schema: parsed.document as unknown as object,
          schemaVersion: parsed.document.schemaVersion,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, page.documentId));
      await this.db.client
        .update(pages)
        .set({ updatedAt: new Date() })
        .where(eq(pages.id, page.id));
    }

    await this.db.client
      .update(projects)
      .set({ currentPageId: page.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return {
      projectId,
      currentPageId: page.id,
      document: parsed.document,
      updatedAt: new Date().toISOString(),
    };
  }

  private async resolvePage(projectId: string, currentPageId: string | null) {
    if (currentPageId) {
      const [candidate] = await this.db.client
        .select()
        .from(pages)
        .where(eq(pages.id, currentPageId))
        .limit(1);
      if (candidate && candidate.projectId === projectId) return candidate;
    }
    return ensureHomePage(this.db, projectId);
  }
}
