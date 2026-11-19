import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { Request } from "express";
import type {
  DocumentResponse,
  VersionDetailResponse,
  VersionListResponse,
} from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { PresenceService } from "../../common/presence.service";
import { documents, pages, projects, versions } from "../../db/schema";
import { uniqueSlug } from "../pages/pages.service";

/**
 * Version history (plan/12 GĐ 5.2).
 *
 * Snapshots are written automatically by the documents controller (throttled)
 * and right before a restore. Restores never delete history: the current state
 * is snapshotted first, so a restore is itself undoable from the timeline.
 *
 * Snapshots are keyed by PROJECT, not only by document: page replacement
 * (AI multi-page, PUT /pages) deletes document rows, and a document-scoped
 * cascade used to erase the whole history silently.
 */
@Controller("projects/:projectId/versions")
export class VersionsController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly presence: PresenceService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Query("pageId") pageId?: string,
  ): Promise<VersionListResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
    await this.assertProject(projectId);

    // History is per page when the query string carries a page row id:
    // resolve it to the document that page owns and filter snapshots by it.
    // Without the filter, list every snapshot of the project — including
    // ones whose document row was replaced (documentId set to null).
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
      .where(
        documentId
          ? and(
              eq(versions.projectId, projectId),
              eq(versions.documentId, documentId),
            )
          : eq(versions.projectId, projectId),
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
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
  ): Promise<VersionDetailResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
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
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Param("versionId") versionId: string,
  ): Promise<DocumentResponse> {
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const version = await this.findVersion(projectId, versionId);

    // Never re-promote an unvalidated snapshot (e.g. written through a legacy
    // or buggy path) onto the live canvas.
    const parsed = uiDocumentSchema.safeParse(version.snapshot);
    if (!parsed.success) {
      throw new BadRequestException(
        `Bản lịch sử ${versionId} chứa document không hợp lệ`,
      );
    }
    const snapshot = parsed.data;

    return this.db.client.transaction(async (tx) => {
      const [current] = version.documentId
        ? await tx
            .select()
            .from(documents)
            .where(eq(documents.id, version.documentId))
            .limit(1)
        : [];

      if (current) {
        // Keep the pre-restore state so the restore can be reversed later.
        await tx.insert(versions).values({
          documentId: current.id,
          projectId: current.projectId,
          snapshot: current.schema as object,
          note: "Trước khi khôi phục",
        });

        // Optimistic-concurrency guard: if someone saved between our read
        // and this write, revision no longer matches and the restore must
        // fail instead of clobbering their work.
        const [saved] = await tx
          .update(documents)
          .set({
            schema: snapshot as unknown as object,
            schemaVersion: snapshot.schemaVersion,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(documents.id, current.id),
              eq(documents.revision, current.revision),
            ),
          )
          .returning();
        if (!saved) {
          throw new ConflictException(
            "Document vừa được cập nhật bởi người khác; thử khôi phục lại.",
          );
        }

        const [page] = await tx
          .select()
          .from(pages)
          .where(eq(pages.documentId, saved.id))
          .limit(1);

        if (page) {
          await tx
            .update(projects)
            .set({ currentPageId: page.id, updatedAt: new Date() })
            .where(eq(projects.id, projectId));

          this.presence.broadcastDocumentUpdate(projectId, {
            pageId: page.id,
            updatedAt: saved.updatedAt.toISOString(),
            actor: { email: user.email },
          });
        } else {
          // The restored document belongs to no page (its page was replaced).
          // Do NOT null currentPageId — that would drop every collaborator
          // onto an arbitrary page. Leave the active page untouched.
          await tx
            .update(projects)
            .set({ updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        }

        return {
          projectId,
          currentPageId: page?.id ?? "",
          document: saved.schema as unknown as UiDocument,
          updatedAt: saved.updatedAt.toISOString(),
          revision: saved.revision,
        };
      }

      // The document row is gone (page replaced / document deleted since the
      // snapshot). Materialize the restore as a new page instead of an
      // orphaned document nobody can open.
      const [doc] = await tx
        .insert(documents)
        .values({
          projectId,
          schemaVersion: snapshot.schemaVersion,
          schema: snapshot as unknown as object,
        })
        .returning();

      const [maxPos] = await tx
        .select({ position: pages.position })
        .from(pages)
        .where(eq(pages.projectId, projectId))
        .orderBy(desc(pages.position))
        .limit(1);

      const slug = await uniqueSlug(
        { client: tx } as unknown as DbService,
        projectId,
        snapshot.name ?? "restored",
      );
      const [page] = await tx
        .insert(pages)
        .values({
          projectId,
          name: snapshot.name ?? "Khôi phục",
          slug,
          position: (maxPos?.position ?? -1) + 1,
          documentId: doc.id,
        })
        .returning();

      // Point the version at its new document so repeated restores update the
      // same page instead of creating a new one each time.
      await tx
        .update(versions)
        .set({ documentId: doc.id })
        .where(eq(versions.id, version.id));

      await tx
        .update(projects)
        .set({ currentPageId: page.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      this.presence.broadcastDocumentUpdate(projectId, {
        pageId: page.id,
        updatedAt: doc.updatedAt.toISOString(),
        actor: { email: user.email },
      });

      return {
        projectId,
        currentPageId: page.id,
        document: doc.schema as unknown as UiDocument,
        updatedAt: doc.updatedAt.toISOString(),
        revision: doc.revision,
      };
    });
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
    // Scoped by versions.projectId directly: an inner join on documents would
    // hide snapshots whose document row was replaced (documentId = null).
    const [row] = await this.db.client
      .select({
        id: versions.id,
        note: versions.note,
        createdAt: versions.createdAt,
        snapshot: versions.snapshot,
        documentId: versions.documentId,
      })
      .from(versions)
      .where(and(eq(versions.id, versionId), eq(versions.projectId, projectId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Bản lịch sử ${versionId} không tồn tại`);
    }
    return row;
  }
}
