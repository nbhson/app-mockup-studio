import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type {
  ApplyDesignSystemInput,
  ApplyDesignSystemResponse,
} from "@ai-mockup-studio/shared-types";
import type { Theme, UiDocument } from "@ai-mockup-studio/ui-schema";
import { applyDesignSystemSchema } from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import {
  designSystems,
  documents,
  pages,
  projects,
} from "../../db/schema";
import { applyThemeToDocument } from "./design-systems.service";

/**
 * Apply a custom design system to a project (plan/07 4.8). Every page document
 * gets the same theme, so switching systems is deterministic and immediate.
 */
@Controller("projects/:projectId/design-system")
export class ProjectDesignSystemController {
  constructor(private readonly db: DbService) {}

  @Post()
  async apply(
    @Param("projectId") projectId: string,
    @Body() body: ApplyDesignSystemInput,
  ): Promise<ApplyDesignSystemResponse> {
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

    const updatedPages = await this.db.client.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ designSystemId: system.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      const projectPages = await tx
        .select({ documentId: pages.documentId })
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
      if (documentIds.length === 0) return 0;

      const rows = await tx
        .select()
        .from(documents)
        .where(inArray(documents.id, documentIds));

      for (const row of rows) {
        const schema = row.schema as UiDocument;
        await tx
          .update(documents)
          .set({
            schema: applyThemeToDocument(schema, theme),
            updatedAt: new Date(),
          })
          .where(eq(documents.id, row.id));
      }
      return rows.length;
    });

    return {
      projectId,
      designSystemId: system.id,
      theme,
      updatedPages,
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
