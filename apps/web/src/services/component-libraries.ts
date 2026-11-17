// Client helpers for component libraries (plan/07 4.3). A library is a named
// collection of node templates that can be stamped into any project page; the
// JSON export/import makes it trivial to share libraries across workspaces.
import type {
  AddLibraryComponentInput,
  ComponentLibraryDto,
  ComponentLibraryListResponse,
  CreateLibraryInput,
  LibraryComponentDto,
  LibraryExportPayload,
  UpdateLibraryComponentInput,
  UpdateLibraryInput,
} from "@ai-mockup-studio/shared-types";
import { api } from "./api";

export async function listComponentLibraries(): Promise<ComponentLibraryListResponse> {
  return api.get<ComponentLibraryListResponse>("/component-libraries");
}

export async function createComponentLibrary(
  input: CreateLibraryInput,
): Promise<ComponentLibraryDto> {
  return api.post<ComponentLibraryDto>("/component-libraries", input);
}

export async function getComponentLibrary(id: string): Promise<ComponentLibraryDto> {
  return api.get<ComponentLibraryDto>(`/component-libraries/${id}`);
}

export async function updateComponentLibrary(
  id: string,
  input: UpdateLibraryInput,
): Promise<ComponentLibraryDto> {
  return api.patch<ComponentLibraryDto>(`/component-libraries/${id}`, input);
}

export async function deleteComponentLibrary(id: string): Promise<void> {
  await api.delete(`/component-libraries/${id}`);
}

export async function addLibraryComponent(
  libraryId: string,
  input: AddLibraryComponentInput,
): Promise<LibraryComponentDto> {
  return api.post<LibraryComponentDto>(
    `/component-libraries/${libraryId}/components`,
    input,
  );
}

export async function updateLibraryComponent(
  libraryId: string,
  componentId: string,
  input: UpdateLibraryComponentInput,
): Promise<LibraryComponentDto> {
  return api.patch<LibraryComponentDto>(
    `/component-libraries/${libraryId}/components/${componentId}`,
    input,
  );
}

export async function removeLibraryComponent(
  libraryId: string,
  componentId: string,
): Promise<{ library: ComponentLibraryDto; removed: string }> {
  return api.delete<{ library: ComponentLibraryDto; removed: string }>(
    `/component-libraries/${libraryId}/components/${componentId}`,
  );
}

export async function importComponentLibrary(
  payload: LibraryExportPayload,
): Promise<ComponentLibraryDto> {
  return api.post<ComponentLibraryDto>("/component-libraries/import", payload);
}

/** Serialize a library into a portable shareable JSON string. */
export function serializeLibrary(lib: ComponentLibraryDto): string {
  const payload: LibraryExportPayload = {
    kind: "ai-mockup-studio/component-library",
    version: 1,
    name: lib.name,
    description: lib.description ?? null,
    components: lib.components.map((c) => ({
      type: c.type,
      label: c.label,
      category: c.category,
      schema: c.schema,
      tags: c.tags,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function libraryExportFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "component-library"}.library.json`;
}

/**
 * Parse an imported library JSON string. Accepts a full exported bundle.
 * Returns a LibraryExportPayload; throws a readable Vietnamese error when
 * the payload does not look like a component library.
 */
export function parseLibraryImport(text: string): LibraryExportPayload {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("JSON không hợp lệ — kiểm tra lại file thư viện.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File thư viện phải là một JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "ai-mockup-studio/component-library") {
    throw new Error("File này không phải component library.");
  }
  if (!Array.isArray(record.components)) {
    throw new Error("Thư viện cần có danh sách components.");
  }
  const rawName = typeof record.name === "string" ? record.name.trim() : "";
  return {
    kind: "ai-mockup-studio/component-library",
    version: typeof record.version === "number" ? record.version : 1,
    name: rawName || "Imported library",
    description:
      typeof record.description === "string" ? record.description : null,
    components: record.components.map((c) => {
      const comp = c as Record<string, unknown>;
      return {
        type: typeof comp.type === "string" ? comp.type : "layout.container",
        label: typeof comp.label === "string" ? comp.label : "Component",
        category: typeof comp.category === "string" ? comp.category : "custom",
        schema: comp.schema ?? {},
        tags: Array.isArray(comp.tags)
          ? comp.tags.filter((t): t is string => typeof t === "string")
          : [],
      };
    }),
  };
}
