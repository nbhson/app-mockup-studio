import type {
  Theme,
  UiDocument,
  UiPatch,
  ViewportMode,
} from "@ai-mockup-studio/ui-schema";

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
  /** Active page row id (empty string when the project has no page yet). */
  currentPageId: string;
  /** null when the project has no document yet (frontend prompts the AI). */
  document: UiDocument | null;
  updatedAt: string;
}

// --- Pages (multi-page, plan/07 3.4) ---------------------------------------

export interface PageSummaryDto {
  id: string;
  name: string;
  slug: string;
  position: number;
  updatedAt: string;
}

export interface PageListResponse {
  projectId: string;
  currentPageId: string | null;
  pages: PageSummaryDto[];
}

export interface PageDetailResponse {
  projectId: string;
  page: PageSummaryDto;
  document: UiDocument;
}

export interface CreatePageInput {
  name: string;
  slug?: string;
  document?: UiDocument;
}

export interface UpdatePageInput {
  name?: string;
  slug?: string;
  position?: number;
}

/** Bulk replace used by AI multi-page generation (atomic in the API). */
export interface ReplacePagesInput {
  pages: Array<{
    name: string;
    slug?: string;
    document: UiDocument;
  }>;
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

// --- AI design critique (plan/07 3.5) --------------------------------------

export type CritiqueCategory =
  | "hierarchy"
  | "spacing"
  | "contrast"
  | "consistency"
  | "accessibility"
  | "content";

export type CritiqueSeverity = "high" | "medium" | "low";

export interface CritiqueFinding {
  id: string;
  category: CritiqueCategory;
  severity: CritiqueSeverity;
  title: string;
  detail: string;
  suggestion: string;
  /** Optional node the finding refers to (null for document-level notes). */
  nodeId?: string | null;
  /** Optional safe style fix the user can apply in one click. */
  fixStyles?: Record<string, unknown> | null;
}

export interface DesignCritiqueRequestBody {
  document: UiDocument;
  viewportMode?: ViewportMode | null;
}

export interface DesignCritiqueResult {
  /** Overall design quality score, 0–100. */
  score: number;
  summary: string;
  findings: CritiqueFinding[];
  /** `ai` when a real model answered, `heuristic` for the offline analyzer. */
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- AI dummy data (plan/07 3.7) -------------------------------------------

export type DummyDataLocale = "vi" | "en";

export interface DummyDataRequestBody {
  document: UiDocument;
  /** Restrict generation to one node (null/omitted = whole document). */
  nodeId?: string | null;
  /** Extra context from the user (e.g. "dashboard bán hàng"). */
  context?: string;
  locale?: DummyDataLocale;
}

export interface DummyDataChange {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  /** Props to merge into the node; the component type never changes. */
  props: Record<string, unknown>;
}

export interface DummyDataResult {
  changes: DummyDataChange[];
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- AI responsive optimization (plan/07 3.8) -----------------------------

export type ResponsiveBreakpoint = "tablet" | "mobile";

export interface ResponsiveSuggestion {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  breakpoint: ResponsiveBreakpoint;
  title: string;
  detail: string;
  /** Overrides to write into `node.responsive[breakpoint]`. */
  styles: Record<string, unknown>;
}

export interface ResponsiveOptimizeRequestBody {
  document: UiDocument;
  /** Breakpoints to analyze; defaults to tablet + mobile. */
  breakpoints?: ResponsiveBreakpoint[];
}

export interface ResponsiveOptimizeResult {
  suggestions: ResponsiveSuggestion[];
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- AI component recommendation (plan/07 3.9) ----------------------------

export interface ComponentRecommendation {
  type: string;
  label: string;
  category: string;
  reason: string;
  /** Confidence 0–100, used for ranking and display. */
  score: number;
}

export interface ComponentRecommendRequestBody {
  document: UiDocument;
  /** Optional description of what the user wants to build next. */
  prompt?: string;
  /** Max number of suggestions (1–12, default 6). */
  max?: number;
}

export interface ComponentRecommendResult {
  suggestions: ComponentRecommendation[];
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- AI image-to-UI (plan/07 3.1) -----------------------------------------

export type ImageToUiMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageToUiRequestBody {
  /** Raw base64 or a data: URL. Max 5 MB. */
  imageBase64: string;
  mimeType: ImageToUiMimeType;
  /** Optional description of the screen to guide the reconstruction. */
  prompt?: string;
  viewport?: "desktop" | "tablet" | "mobile";
}

export interface ImageToUiResult {
  document: UiDocument;
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
  image: {
    width: number;
    height: number;
    mimeType: ImageToUiMimeType;
  };
}

// --- AI URL-to-UI (plan/07 3.2) -------------------------------------------

export interface UrlToUiRequestBody {
  url: string;
  /** Optional description of the page or which parts to keep. */
  prompt?: string;
}

export interface UrlToUiSiteInfo {
  title: string;
  description?: string;
  image?: string;
}

export interface UrlToUiResult {
  document: UiDocument;
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
  /** Final URL after safe redirects. */
  url: string;
  site: UrlToUiSiteInfo;
}

// --- AI design reference (plan/07 3.3) ------------------------------------

export interface DesignReferenceRequestBody {
  /** Raw base64 or a data: URL. Max 5 MB. */
  imageBase64: string;
  mimeType: ImageToUiMimeType;
  /** Optional palette extracted client-side (canvas) for formats the server cannot decode. */
  palette?: string[];
}

export interface DesignReferenceColor {
  hex: string;
  /** Approximate share of sampled pixels (0–1). */
  share: number;
  role?: "background" | "foreground" | "primary";
}

export interface DesignReferenceResult {
  palette: DesignReferenceColor[];
  theme: Theme;
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- AI multi-page generation (plan/07 3.4) --------------------------------

export interface MultiPageRequestBody {
  prompt: string;
  /** Number of pages to generate (2–5, default 3). */
  pageCount?: number;
  viewportMode?: ViewportMode;
}

export interface GeneratedPage {
  name: string;
  slug: string;
  document: UiDocument;
}

export interface MultiPageResult {
  pages: GeneratedPage[];
  /** Shared theme applied to every generated page. */
  theme: Theme;
  summary: string;
  source: "ai" | "heuristic";
  model?: string | null;
}

// --- Shares (public/private preview links, plan/07 4.7) --------------------

export type ShareVisibility = "public" | "private";

export interface ShareDto {
  id: string;
  token: string;
  visibility: ShareVisibility;
  hasPassword: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  /** Web-app path for the share, e.g. `/share/<token>`. */
  path: string;
}

export interface ShareListResponse {
  projectId: string;
  shares: ShareDto[];
}

export interface CreateShareInput {
  visibility: ShareVisibility;
  /** Required when visibility is `private` (min 4 chars). */
  password?: string;
  /** Link lifetime in days; omitted means it never expires. */
  expiresInDays?: number;
}

export interface PublicSharePageDto {
  name: string;
  slug: string;
  document: UiDocument;
}

/** Read-only payload served by `GET /share/:token` (no auth required). */
export interface PublicShareResponse {
  token: string;
  projectName: string;
  visibility: ShareVisibility;
  pages: PublicSharePageDto[];
  createdAt: string;
  expiresAt: string | null;
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
