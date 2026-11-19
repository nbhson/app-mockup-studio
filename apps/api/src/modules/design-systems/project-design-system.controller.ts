import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import type {
  ApplyDesignSystemInput,
  ApplyDesignSystemResponse,
} from "@ai-mockup-studio/shared-types";
import type { Theme, UiDocument } from "@ai-mockup-studio/ui-schema";
import { applyDesignSystemSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import { AccessService } from "../../common/access.service";
import { PresenceService } from "../../common/presence.service";
import {
  designSystems,
  documents,
  pages,
  projects,
} from "../../db/schema";
import { applyThemeToDocument } from "./design-systems.service";

/** A page whose document was rewritten by `apply()`; sent to presence peers. */
interface PageStamp {
  pageId: string;
  updatedAt: string;
}

/**
 * Apply a custom design system to a project (plan/07 4.8). Every page document
 * gets the same theme, so switching systems is deterministic and immediate.
 */
@Controller("projects/:projectId/design-system")
export class ProjectDesignSystemController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly presence: PresenceService,
  ) {}

  @Post()
  async apply(
    @Param("projectId") projectId: string,
    @Body() body: ApplyDesignSystemInput,
    @Req() req: Request,
  ): Promise<ApplyDesignSystemResponse> {
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    await this.assertProject(projectId);
    const parsed = applyDesignSystemSchema.parse(body);

    if (!parsed.designSystemId) {
      await this.db.client
        .update(projects)
        .set({ designSystemId: null, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      return {
        projectId,
        designSystemId: null,
        theme: null,
        updatedPages: 0,
      };
    }

    const [system] = await this.db.client
      .select()
      .from(designSystems)
      .where(eq(designSystems.id, parsed.designSystemId))
      .limit(1);
    if (!system) {
      throw new NotFoundException(
        `Design system ${parsed.designSystemId} không tồn tại`,
      );
    }
    const theme = system.theme as Theme;

    const updated = await this.db.client.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ designSystemId: system.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      const projectPages = await tx
        .select({ id: pages.id, documentId: pages.documentId })
        .from(pages)
        .where(eq(pages.projectId, projectId));

      let documentIds = projectPages.map((page) => page.documentId);
      if (documentIds.length === 0) {
        // Legacy project that has not been wrapped in a page yet.
        const legacyDocs = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.projectId, projectId));
        documentIds = legacyDocs.map((document) => document.id);
      }
      if (documentIds.length === 0) return { count: 0, updates: [] as PageStamp[] };

      const rows = await tx
        .select()
        .from(documents)
        .where(inArray(documents.id, documentIds));

      // Keep document -> page mapping so the broadcast after the transaction
      // tells every collaborator exactly which page to refetch.
      const pageIdByDocumentId = new Map(
        projectPages.map((page) => [page.documentId, page.id]),
      );
      const updates: PageStamp[] = [];
      for (const row of rows) {
        const schema = row.schema as UiDocument;
        const updatedAt = new Date();
        await tx
          .update(documents)
          .set({
            schema: applyThemeToDocument(schema, theme),
            revision: row.revision + 1,
            updatedAt,
          })
          .where(eq(documents.id, row.id));
        const pageId = pageIdByDocumentId.get(row.id);
        if (pageId) updates.push({ pageId, updatedAt: updatedAt.toISOString() });
      }
      return { count: rows.length, updates };
    });

    // Broadcast only after COMMIT: a rolled-back transaction must not tell
    // peers to reload data that never landed. Every page document in the
    // project just changed (revision bumped), so without this other editors
    // keep stale canvases and get a 409 on their next autosave.
    for (const stamp of updated.updates) {
      this.presence.broadcastDocumentUpdate(projectId, {
        pageId: stamp.pageId,
        updatedAt: stamp.updatedAt,
        actor: { email: user.email },
      });
    }

    return {
      projectId,
      designSystemId: system.id,
      theme,
      updatedPages: updated.count,
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
}
