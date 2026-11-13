import type { UiDocument, UiPatch, ViewportMode } from "@ai-mockup-studio/ui-schema";

// ---------------------------------------------------------------------------
// API contract types shared between apps/web and apps/api.
// (plan/13: "Technical Architecture Blueprint → API contracts" v0)
// ---------------------------------------------------------------------------

// --- Projects --------------------------------------------------------------

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

// --- Documents -------------------------------------------------------------

export interface SaveDocumentBody {
  document: UiDocument;
  /** Optional base version for optimistic concurrency (left null for MVP). */
  baseVersion?: string | null;
}

export interface DocumentResponse {
  projectId: string;
  currentPageId: string;
  /** null when the project has no document yet (frontend prompts the AI). */
  document: UiDocument | null;
  updatedAt: string;
}

// --- Versions (history) -----------------------------------------------------

export interface VersionSummaryDto {
  id: string;
  note: string | null;
  createdAt: string;
}

export interface VersionListResponse {
  projectId: string;
  versions: VersionSummaryDto[];
}

export interface VersionDetailResponse extends VersionSummaryDto {
  document: UiDocument;
}

// --- Assets ----------------------------------------------------------------

export interface AssetDto {
  id: string;
  projectId: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** Same-origin URL the canvas can use as <img src>. */
  url: string;
  createdAt: string;
}

export interface AssetListResponse {
  projectId: string;
  assets: AssetDto[];
}

export interface UploadAssetBody {
  fileName: string;
  mimeType: string;
  /** File bytes without the `data:` URL prefix. */
  dataBase64: string;
}

// --- AI ----------------------------------------------------- ----------------

export type AiTaskType = "UI_GENERATION" | "UI_EDITING" | "IMAGE_UNDERSTANDING" | "DESIGN_ANALYSIS";

export interface GenerateRequestBody {
  prompt: string;
  model?: string | null;
  viewportMode?: ViewportMode | null;
}

export interface AiEditRequestBody {
  prompt: string;
  document: UiDocument;
  /** Optional: the currently selected node id, so edits can be scoped. */
  targetId?: string | null;
  model?: string | null;
}

export interface GenerateResult {
  document: UiDocument;
  /** Summary the assistant shows to the user after generation. */
  summary: string;
  /** Optional raw explanation from the model for debugging (AI State). */
  raw?: string | null;
}

export interface AiEditResult {
  document: UiDocument;
  patches: UiPatch[];
  summary: string;
}

// --- Health -----------------------------------------------------------------

export interface HealthResponse {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  /** Dependency checks surfaced by the readiness probe. */
  checks?: {
    database: "up" | "down";
  };
  version?: string;
}

// --- Errors -----------------------------------------------------------------

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
}
