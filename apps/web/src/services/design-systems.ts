// Client helpers for custom design systems (plan/07 4.8). Tokens are the same
// Theme object a document uses, so import/export is plain JSON.
import type {
  ApplyDesignSystemResponse,
  CreateDesignSystemInput,
  DesignSystemDto,
  DesignSystemListResponse,
  UpdateDesignSystemInput,
} from "@ai-mockup-studio/shared-types";
import { themeSchema } from "@ai-mockup-studio/validators";
import type { Theme, UiDocument } from "@ai-mockup-studio/ui-schema";
import { api } from "./api";

export async function listDesignSystems(): Promise<DesignSystemListResponse> {
  return api.get<DesignSystemListResponse>("/design-systems");
}

export async function createDesignSystem(
  input: CreateDesignSystemInput,
): Promise<DesignSystemDto> {
  return api.post<DesignSystemDto>("/design-systems", input);
}

export async function updateDesignSystem(
  id: string,
  input: UpdateDesignSystemInput,
): Promise<DesignSystemDto> {
  return api.patch<DesignSystemDto>(`/design-systems/${id}`, input);
}

export async function deleteDesignSystem(id: string): Promise<DesignSystemListResponse> {
  return api.delete<DesignSystemListResponse>(`/design-systems/${id}`);
}

export async function applyDesignSystemToProject(
  projectId: string,
  designSystemId: string | null,
): Promise<ApplyDesignSystemResponse> {
  return api.post<ApplyDesignSystemResponse>(
    `/projects/${projectId}/design-system`,
    { designSystemId },
  );
}

/** Build a create-input from any theme source (form, document, imported file). */
export function designSystemFromTheme(
  theme: Theme,
  name: string,
  description?: string,
): CreateDesignSystemInput {
  const input: CreateDesignSystemInput = {
    name: name.trim(),
    theme: { ...theme },
  };
  const note = description?.trim();
  if (note) input.description = note;
  return input;
}

/** Seed a new system from the mockup currently open in the editor. */
export function designSystemFromDocument(
  doc: UiDocument,
  name: string,
  description?: string,
): CreateDesignSystemInput {
  return designSystemFromTheme(doc.theme, name, description);
}

/**
 * Export a reusable token file. The payload intentionally keeps the full
 * design-system metadata so importing it recreates the same named system.
 */
export function serializeDesignSystemTokens(system: DesignSystemDto): string {
  const payload = {
    kind: "ai-mockup-studio/design-system",
    version: 1,
    name: system.name,
    description: system.description,
    theme: system.theme,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function designSystemExportFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "design-system"}.tokens.json`;
}

/**
 * Accept either a full exported file or a bare Theme object. Returns a
 * CreateDesignSystemInput; throws a readable Vietnamese error when invalid.
 */
export function parseDesignSystemTokens(
  text: string,
  fallbackName = "Imported design system",
): CreateDesignSystemInput {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("JSON không hợp lệ — kiểm tra lại file token.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File token phải là một JSON object.");
  }

  const record = value as Record<string, unknown>;
  const candidateTheme =
    record.theme && typeof record.theme === "object" && !Array.isArray(record.theme)
      ? record.theme
      : record;

  const parsed = themeSchema.safeParse(candidateTheme);
  if (!parsed.success) {
    throw new Error("Theme token thiếu trường hoặc sai định dạng.");
  }
  const theme = parsed.data as Theme;

  const rawName = typeof record.name === "string" ? record.name.trim() : "";
  const rawDescription =
    typeof record.description === "string" ? record.description.trim() : "";
  const input: CreateDesignSystemInput = {
    name: rawName || fallbackName,
    theme,
  };
  if (rawDescription) input.description = rawDescription;
  return input;
}
