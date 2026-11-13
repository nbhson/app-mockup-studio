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
import { projects, documents, versions } from "../../db/schema";

@Controller("projects/:projectId/document")
export class DocumentsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async get(@Param("projectId") projectId: string): Promise<DocumentResponse> {
    const [doc] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .limit(1);
    const [project] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);

    return {
      projectId,
      currentPageId: project.currentPageId ?? "",
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

    const [existing] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .limit(1);

    // Before overwriting, keep an immutable snapshot in history (plan/10 versions).
    // Autosave can fire every few seconds, so throttle snapshots to one per
    // 5 minutes; "important" versions can be added explicitly later.
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

    const saved = existing
      ? (
          await this.db.client
            .update(documents)
            .set({ schema: parsed.document as unknown as object, updatedAt: new Date() })
            .where(eq(documents.projectId, projectId))
            .returning()
        )[0]
      : (
          await this.db.client
            .insert(documents)
            .values({
              projectId,
              schemaVersion: parsed.document.schemaVersion,
              schema: parsed.document as unknown as object,
            })
            .returning()
        )[0];

    await this.db.client
      .update(projects)
      .set({ currentPageId: parsed.document.pageId, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return {
      projectId,
      currentPageId: parsed.document.pageId,
      document: saved.schema as unknown as UiDocument,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}
