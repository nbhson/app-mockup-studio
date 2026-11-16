import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type {
  DocumentResponse,
  VersionDetailResponse,
  VersionListResponse,
} from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { documents, pages, projects, versions } from "../../db/schema";

/**
 * Version history (plan/12 GĐ 5.2).
 *
 * Snapshots are written automatically by the documents controller (throttled)
 * and right before a restore. Restores never delete history: the current state
 * is snapshotted first, so a restore is itself undoable from the timeline.
 */
@Controller("projects/:projectId/versions")
export class VersionsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("pageId") pageId?: string,
  ): Promise<VersionListResponse> {
    await this.assertProject(projectId);

    // History is per page: the query string carries a page row id, so resolve
    // it to the document that page owns before filtering snapshots.
    let documentId: string | undefined;
    if (pageId) {
      const [page] = await this.db.client
        .select({ documentId: pages.documentId })
        .from(pages)
        .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
        .limit(1);
      if (!page) throw new NotFoundException(`Trang ${pageId} không tồn tại`);
      documentId = page.documentId;
    }

    const rows = await this.db.client
      .select({
        id: versions.id,
        note: versions.note,
        createdAt: versions.createdAt,
      })
      .from(versions)
      .innerJoin(documents, eq(versions.documentId, documents.id))
      .where(
        documentId
          ? and(eq(documents.projectId, projectId), eq(documents.id, documentId))
          : eq(documents.projectId, projectId),
      )
      .orderBy(desc(versions.createdAt))
      .limit(50);

    return {
      projectId,
      versions: rows.map((row) => ({
        id: row.id,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get(":versionId")
  async detail(
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
  ): Promise<VersionDetailResponse> {
    const version = await this.findVersion(projectId, versionId);
    const snapshot = version.snapshot as unknown as UiDocument;
    return {
      id: version.id,
      note: version.note,
      createdAt: version.createdAt.toISOString(),
      document: snapshot,
    };
  }

  @Post(":versionId/restore")
  async restore(
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
  ): Promise<DocumentResponse> {
    const version = await this.findVersion(projectId, versionId);

    const [current] = await this.db.client
      .select()
      .from(documents)
      .where(eq(documents.id, version.documentId))
      .limit(1);

    if (current) {
      // Keep the pre-restore state so the restore can be reversed later.
      await this.db.client.insert(versions).values({
        documentId: current.id,
        snapshot: current.schema as object,
        note: "Trước khi khôi phục",
      });
    }

    const snapshot = version.snapshot as unknown as UiDocument;
    const saved = current
      ? (
          await this.db.client
            .update(documents)
            .set({
              schema: snapshot as unknown as object,
              schemaVersion: snapshot.schemaVersion,
              updatedAt: new Date(),
            })
            .where(eq(documents.id, current.id))
            .returning()
        )[0]
      : (
          await this.db.client
            .insert(documents)
            .values({
              projectId,
              schemaVersion: snapshot.schemaVersion,
              schema: snapshot as unknown as object,
            })
            .returning()
        )[0];

    const [page] = await this.db.client
      .select()
      .from(pages)
      .where(eq(pages.documentId, saved.id))
      .limit(1);

    await this.db.client
      .update(projects)
      .set({ currentPageId: page?.id ?? null, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return {
      projectId,
      currentPageId: page?.id ?? "",
      document: saved.schema as unknown as UiDocument,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  private async assertProject(projectId: string): Promise<void> {
    const [project] = await this.db.client
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);
  }

  private async findVersion(projectId: string, versionId: string) {
    const [row] = await this.db.client
      .select({
        id: versions.id,
        note: versions.note,
        createdAt: versions.createdAt,
        snapshot: versions.snapshot,
        documentId: versions.documentId,
      })
      .from(versions)
      .innerJoin(documents, eq(versions.documentId, documents.id))
      .where(and(eq(versions.id, versionId), eq(documents.projectId, projectId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Bản lịch sử ${versionId} không tồn tại`);
    }
    return row;
  }
}
