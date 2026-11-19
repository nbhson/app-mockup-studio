// Documents service (plan/07 4.10). The single write path for a page's
// document: used by the HTTP controller and by plugin runs so both honor
// optimistic concurrency, version snapshots and presence broadcasts.
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { DocumentResponse } from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { PresenceService } from "../../common/presence.service";
import { projects, documents, pages, versions } from "../../db/schema";
import { ensureHomePage, uniqueSlug } from "../pages/pages.service";

export interface SaveDocumentInput {
  document: UiDocument;
  baseVersion?: string | null;
  actor: { email: string; name: string | null; id: string };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly presence: PresenceService,
  ) {}

  /** Read the active page's document (or null when the project has no page). */
  async getDocument(projectId: string): Promise<DocumentResponse> {
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
        revision: 0,
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
      revision: doc?.revision ?? 0,
    };
  }

  /**
   * Persist a document for the active page, creating the home page on first
   * write. Honors optimistic concurrency (409 on stale baseVersion), keeps an
   * immutable autosave snapshot (throttled) and broadcasts the change so
   * connected collaborators refresh their canvas.
   */
  async saveDocument(
    projectId: string,
    input: SaveDocumentInput,
  ): Promise<DocumentResponse> {
    const parsed = input;
    const [project] = await this.db.client
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);

    let page = await this.resolvePage(projectId, project.currentPageId);
    let savedAt: Date;
    let savedRevision: number;

    if (!page) {
      // Document + home page must be created atomically: a failed page insert
      // used to leave an orphan document that `ensureHomePage` could later
      // promote as the project's "Home" with arbitrary content.
      const [doc, created] = await this.db.client.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(documents)
          .values({
            projectId,
            schemaVersion: parsed.document.schemaVersion,
            schema: parsed.document as unknown as object,
          })
          .returning();
        const slug = await uniqueSlug(
          { client: tx } as unknown as DbService,
          projectId,
          "home",
        );
        const [row] = await tx
          .insert(pages)
          .values({
            projectId,
            name: parsed.document.name?.trim() || "Home",
            slug,
            position: 0,
            documentId: inserted.id,
          })
          .returning();
        return [inserted, row] as const;
      });
      page = created;
      savedAt = doc.updatedAt;
      savedRevision = doc.revision;
    } else {
      const [existing] = await this.db.client
        .select()
        .from(documents)
        .where(eq(documents.id, page.documentId))
        .limit(1);
      if (!existing) throw new NotFoundException(`Trang ${page.id} không có document`);

      // Optimistic concurrency (plan/07 4.4): a stale baseVersion means someone
      // else saved first. Reject instead of silently overwriting their work.
      const conflict = () =>
        new ConflictException({
          message:
            "Document đã được người khác cập nhật. Hãy tải bản mới nhất trước khi lưu.",
          currentVersion: String(existing.revision),
        });
      if (
        parsed.baseVersion &&
        parsed.baseVersion !== String(existing.revision)
      ) {
        throw conflict();
      }

      // Before overwriting, keep an immutable snapshot in history (plan/10
      // versions). Autosave can fire every few seconds, so throttle snapshots
      // to one per 5 minutes.
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
          projectId: existing.projectId,
          snapshot: existing.schema as object,
          note: "Autosave",
        });
      }

      // The revision guard closes the race between the check above and the
      // update: a concurrent writer that already bumped revision makes this
      // update match zero rows.
      const guard = parsed.baseVersion
        ? and(
            eq(documents.id, page.documentId),
            eq(documents.revision, existing.revision),
          )
        : eq(documents.id, page.documentId);
      const [saved] = await this.db.client
        .update(documents)
        .set({
          schema: parsed.document as unknown as object,
          schemaVersion: parsed.document.schemaVersion,
          revision: existing.revision + 1,
          updatedAt: new Date(),
        })
        .where(guard)
        .returning();
      if (!saved) throw conflict();
      savedAt = saved.updatedAt;
      savedRevision = saved.revision;

      await this.db.client
        .update(pages)
        .set({ updatedAt: new Date() })
        .where(eq(pages.id, page.id));
    }

    await this.db.client
      .update(projects)
      .set({ currentPageId: page.id, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const updatedAt = savedAt.toISOString();
    this.presence.broadcastDocumentUpdate(projectId, {
      pageId: page.id,
      updatedAt,
      actor: { email: parsed.actor.email },
    });

    return {
      projectId,
      currentPageId: page.id,
      document: parsed.document,
      updatedAt,
      revision: savedRevision,
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
