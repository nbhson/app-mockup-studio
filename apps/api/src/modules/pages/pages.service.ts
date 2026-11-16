// ---------------------------------------------------------------------------
// Pages helpers (plan/07 3.4). A project owns many pages; each page owns one
// document row. `projects.currentPageId` points at the active page row.
// ---------------------------------------------------------------------------

import { and, asc, eq, ne } from "drizzle-orm";
import type { PageSummaryDto } from "@ai-mockup-studio/shared-types";
import {
  SCHEMA_VERSION,
  createId,
  type Theme,
  type UiDocument,
} from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { documents, pages, projects } from "../../db/schema";
import { baseTheme } from "../../sample-documents";

export interface PageRow {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  position: number;
  documentId: string;
  createdAt: Date;
  updatedAt: Date;
}

export function toPageDto(row: PageRow): PageSummaryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Vietnamese-aware slug: "Trang chủ" → "trang-chu". */
export function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "page";
}

/** Return a slug that is unique inside the project (append -2, -3…). */
export async function uniqueSlug(
  db: DbService,
  projectId: string,
  desired: string,
  ignorePageId?: string,
): Promise<string> {
  const base = slugify(desired);
  let candidate = base;
  for (let index = 2; index < 100; index += 1) {
    const [conflict] = await db.client
      .select({ id: pages.id })
      .from(pages)
      .where(
        ignorePageId
          ? and(
              eq(pages.projectId, projectId),
              eq(pages.slug, candidate),
              ne(pages.id, ignorePageId),
            )
          : and(eq(pages.projectId, projectId), eq(pages.slug, candidate)),
      )
      .limit(1);
    if (!conflict) return candidate;
    candidate = `${base}-${index}`;
  }
  return `${base}-${createId("p").slice(-6)}`;
}

/**
 * Ensure the project has at least one page. Existing single-document projects
 * are migrated lazily: a "home" page wraps the legacy document row.
 */
export async function ensureHomePage(
  db: DbService,
  projectId: string,
): Promise<PageRow | null> {
  const [existing] = await db.client
    .select()
    .from(pages)
    .where(eq(pages.projectId, projectId))
    .orderBy(asc(pages.position), asc(pages.createdAt))
    .limit(1);
  if (existing) return existing;

  const [doc] = await db.client
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .limit(1);
  if (!doc) return null;

  const schema = doc.schema as unknown as UiDocument;
  const slug = await uniqueSlug(db, projectId, "home");
  const [page] = await db.client
    .insert(pages)
    .values({
      projectId,
      name: schema.name?.trim() || "Home",
      slug,
      position: 0,
      documentId: doc.id,
    })
    .returning();

  await db.client
    .update(projects)
    .set({ currentPageId: page.id })
    .where(eq(projects.id, projectId));

  return page;
}

/** A minimal valid document for a blank page. */
export function blankDocument(name: string, theme: Theme = baseTheme()): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("doc"),
    pageId: createId("page"),
    name,
    viewport: { width: 1440, height: 900 },
    theme: { ...theme },
    root: {
      id: createId("root"),
      type: "layout.container",
      name: "Container",
      props: {},
      styles: { flexDirection: "column", gap: 16, padding: 24 },
      children: [],
    },
  };
}
