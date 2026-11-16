// ---------------------------------------------------------------------------
// Custom design systems (plan/07 4.8). A system stores the same Theme shape
// documents use; applying it rewrites the theme of every page in the project.
// ---------------------------------------------------------------------------

import type { DesignSystemDto } from "@ai-mockup-studio/shared-types";
import type { Theme, UiDocument } from "@ai-mockup-studio/ui-schema";
import type { DesignSystemRow } from "../../db/schema";

export function toDesignSystemDto(row: DesignSystemRow): DesignSystemDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    theme: row.theme as Theme,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Only the theme changes: layout, content and ids stay untouched. */
export function applyThemeToDocument<T extends UiDocument>(doc: T, theme: Theme): T {
  return { ...doc, theme };
}
