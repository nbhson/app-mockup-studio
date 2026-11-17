// Service helpers for component libraries (plan/07 4.3).
import type {
  ComponentLibraryDto,
  LibraryComponentDto,
  LibraryExportPayload,
} from "@ai-mockup-studio/shared-types";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import type {
  ComponentLibraryRow,
  LibraryComponentRow,
} from "../../db/schema";

export function toLibraryDto(
  row: ComponentLibraryRow,
  components: LibraryComponentRow[],
): ComponentLibraryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    version: row.version,
    components: components.map(toComponentDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toComponentDto(row: LibraryComponentRow): LibraryComponentDto {
  return {
    id: row.id,
    libraryId: row.libraryId,
    type: row.type,
    label: row.label,
    category: row.category,
    schema: row.schema,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
  };
}

export function buildExportPayload(
  lib: ComponentLibraryDto,
): LibraryExportPayload {
  return {
    kind: "ai-mockup-studio/component-library",
    version: 1,
    name: lib.name,
    description: lib.description,
    components: lib.components.map((c) => ({
      type: c.type,
      label: c.label,
      category: c.category,
      schema: c.schema,
      tags: c.tags,
    })),
  };
}

export function validateComponentSchema(
  schema: unknown,
): schema is UiNode {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as Record<string, unknown>;
  return (
    typeof s["id"] === "string" &&
    typeof s["type"] === "string" &&
    (s["children"] === undefined ||
      (Array.isArray(s["children"]) && s["children"].every(validateComponentSchema)))
  );
}
