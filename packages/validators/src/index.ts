import { z } from "zod";
import type { UiNode } from "@ai-mockup-studio/ui-schema";

// ---------------------------------------------------------------------------
// Zod schemas — runtime validation for UI schema, patches & API bodies.
// (plan/08: `validators` package is used by BOTH web and api.)
// ---------------------------------------------------------------------------

const uiStylesSchema = z
  .object({
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    minWidth: z.union([z.number(), z.string()]).optional(),
    minHeight: z.union([z.number(), z.string()]).optional(),
    padding: z.union([z.number(), z.string()]).optional(),
    margin: z.union([z.number(), z.string()]).optional(),
    gap: z.union([z.number(), z.string()]).optional(),
    display: z.string().optional(),
    flex: z.union([z.number(), z.string()]).optional(),
    flexDirection: z.enum(["row", "column"]).optional(),
    flexWrap: z.enum(["nowrap", "wrap", "wrap-reverse"]).optional(),
    flexShrink: z.number().optional(),
    alignItems: z.string().optional(),
    justifyContent: z.string().optional(),
    backgroundColor: z.string().optional(),
    color: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.union([z.number(), z.string()]).optional(),
    fontWeight: z.union([z.number(), z.string()]).optional(),
    borderWidth: z.number().optional(),
    borderColor: z.string().optional(),
    borderRadius: z.number().optional(),
    opacity: z.number().optional(),
  })
  .passthrough();

const responsiveStylesSchema = z
  .object({
    tablet: uiStylesSchema.optional(),
    mobile: uiStylesSchema.optional(),
  })
  .passthrough();

export const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    responsive: responsiveStylesSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    styles: uiStylesSchema.optional(),
    children: z.array(uiNodeSchema).optional(),
  }),
);

export const viewportSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const themeSchema = z.object({
  mode: z.enum(["light", "dark"]),
  primary: z.string(),
  primaryForeground: z.string(),
  background: z.string(),
  foreground: z.string(),
  muted: z.string(),
  mutedForeground: z.string(),
  border: z.string(),
  fontFamily: z.string(),
  radius: z.number(),
});

export const uiDocumentSchema = z.object({
  schemaVersion: z.string(),
  id: z.string().min(1),
  pageId: z.string().min(1),
  name: z.string().min(1),
  viewport: viewportSchema,
  theme: themeSchema,
  root: uiNodeSchema,
});

// --- Patches ---------------------------------------------------------------

export const addPatchSchema = z.object({
  op: z.literal("add"),
  parentId: z.string().min(1),
  index: z.number().int().optional(),
  node: uiNodeSchema,
});

export const updatePatchSchema = z.object({
  op: z.literal("update"),
  targetId: z.string().min(1),
  changes: z.record(z.string(), z.unknown()),
});

export const removePatchSchema = z.object({
  op: z.literal("remove"),
  targetId: z.string().min(1),
});

export const movePatchSchema = z.object({
  op: z.literal("move"),
  targetId: z.string().min(1),
  newParentId: z.string().min(1),
  index: z.number().int().optional(),
});

export const replacePatchSchema = z.object({
  op: z.literal("replace"),
  targetId: z.string().min(1),
  node: uiNodeSchema,
});

export const stylePatchSchema = z.object({
  op: z.literal("style"),
  targetId: z.string().min(1),
  styles: uiStylesSchema,
});

export const uiPatchSchema = z.discriminatedUnion("op", [
  addPatchSchema,
  updatePatchSchema,
  removePatchSchema,
  movePatchSchema,
  replacePatchSchema,
  stylePatchSchema,
]);

export const patchBatchSchema = z.object({
  documentId: z.string().min(1),
  patches: z.array(uiPatchSchema),
});

// --- API bodies ------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const saveDocumentSchema = z.object({
  document: uiDocumentSchema,
  baseVersion: z.string().nullable().optional(),
});

// --- Pages (plan/07 3.4) ---------------------------------------------------

const pageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug chỉ gồm chữ thường, số và dấu gạch ngang");

export const createPageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: pageSlugSchema.optional(),
  document: uiDocumentSchema.optional(),
});

export const updatePageSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: pageSlugSchema.optional(),
  position: z.number().int().min(0).max(999).optional(),
});

export const replacePagesSchema = z.object({
  pages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        slug: pageSlugSchema.optional(),
        document: uiDocumentSchema,
      }),
    )
    .min(1)
    .max(8),
});

export const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().nullable().optional(),
  viewportMode: z.enum(["desktop", "tablet", "mobile"]).optional(),
});

export const aiEditRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  document: uiDocumentSchema,
  targetId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});

export const critiqueCategorySchema = z.enum([
  "hierarchy",
  "spacing",
  "contrast",
  "consistency",
  "accessibility",
  "content",
]);

export const critiqueSeveritySchema = z.enum(["high", "medium", "low"]);

export const critiqueFindingSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  category: critiqueCategorySchema,
  severity: critiqueSeveritySchema,
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(1200),
  suggestion: z.string().trim().min(1).max(1200),
  nodeId: z.string().nullable().optional(),
  fixStyles: z.record(z.string(), z.unknown()).nullable().optional(),
});

/** Shape the model must return (also used to validate the LLM response). */
export const critiqueResponseSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().trim().min(1).max(3000),
  findings: z.array(critiqueFindingSchema).max(50),
});

export const critiqueRequestSchema = z.object({
  document: uiDocumentSchema,
  viewportMode: z.enum(["desktop", "tablet", "mobile"]).nullable().optional(),
});

export const dummyDataLocaleSchema = z.enum(["vi", "en"]);

export const dummyDataRequestSchema = z.object({
  document: uiDocumentSchema,
  nodeId: z.string().nullable().optional(),
  context: z.string().trim().max(500).optional(),
  locale: dummyDataLocaleSchema.optional(),
});

/** Shape the model must return (also used to validate the LLM response). */
export const dummyDataResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  changes: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        props: z.record(z.string(), z.unknown()),
      }),
    )
    .max(30),
});

export const responsiveBreakpointSchema = z.enum(["tablet", "mobile"]);

export const responsiveRequestSchema = z.object({
  document: uiDocumentSchema,
  breakpoints: z.array(responsiveBreakpointSchema).min(1).max(2).optional(),
});

/** Shape the model must return (also used to validate the LLM response). */
export const responsiveResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  suggestions: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        breakpoint: responsiveBreakpointSchema,
        title: z.string().trim().min(1).max(200).optional(),
        detail: z.string().trim().min(1).max(600).optional(),
        styles: z.record(z.string(), z.unknown()),
      }),
    )
    .max(60),
});

export const componentRecommendRequestSchema = z.object({
  document: uiDocumentSchema,
  prompt: z.string().trim().max(1000).optional(),
  max: z.number().int().min(1).max(12).optional(),
});

/** Shape the model must return (also used to validate the LLM response). */
export const componentRecommendResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  suggestions: z
    .array(
      z.object({
        type: z.string().min(1).max(100),
        reason: z.string().trim().min(1).max(600),
        score: z.number().min(0).max(100).optional(),
      }),
    )
    .max(12),
});

export const imageToUiRequestSchema = z.object({
  imageBase64: z.string().min(32).max(8_000_000),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  prompt: z.string().trim().max(1000).optional(),
  viewport: z.enum(["desktop", "tablet", "mobile"]).optional(),
});

export const urlToUiRequestSchema = z.object({
  url: z.string().trim().url().max(2000),
  prompt: z.string().trim().max(1000).optional(),
});

export const designReferenceRequestSchema = z.object({
  imageBase64: z.string().min(32).max(8_000_000),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  palette: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .max(16)
    .optional(),
});

/** Shape the vision model must return for a design reference. */
export const designReferenceResponseSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  colors: z
    .array(
      z.object({
        hex: z.string().regex(/^#[0-9a-f]{6}$/i),
        role: z.enum(["background", "foreground", "primary"]).optional(),
      }),
    )
    .min(2)
    .max(12),
  fontFamily: z.string().trim().min(1).max(120).optional(),
  radius: z.number().min(0).max(40).optional(),
});

// --- AI multi-page (plan/07 3.4) ------------------------------------------

export const multiPageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  pageCount: z.number().int().min(2).max(5).optional(),
  viewportMode: z.enum(["desktop", "tablet", "mobile"]).optional(),
});

export const multiPageResponseSchema = z.object({
  summary: z.string().trim().min(1).max(1000),
  pages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        slug: pageSlugSchema,
        document: uiDocumentSchema,
      }),
    )
    .min(2)
    .max(5),
});

// --- Shares (plan/07 4.7) --------------------------------------------------

export const shareVisibilitySchema = z.enum(["public", "private"]);

export const createShareSchema = z
  .object({
    visibility: shareVisibilitySchema,
    password: z.string().min(4).max(128).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.visibility === "private" && !value.password) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Link riêng tư cần mật khẩu (ít nhất 4 ký tự)",
      });
    }
  });

// --- Design systems (plan/07 4.8) ------------------------------------------

export const createDesignSystemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  theme: themeSchema,
});

export const updateDesignSystemSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  theme: themeSchema.optional(),
});

export const applyDesignSystemSchema = z.object({
  designSystemId: z.string().trim().min(1).max(120).nullable(),
});

// --- Component libraries (plan/07 4.3) -------------------------------------

export const createLibrarySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const updateLibrarySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const addLibraryComponentSchema = z.object({
  type: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  category: z.string().trim().max(80).optional(),
  schema: z.object({}).passthrough(), // any JSON object
  tags: z.array(z.string().trim().max(60)).optional(),
});

export const updateLibraryComponentSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(80).optional(),
  schema: z.object({}).passthrough().optional(),
  tags: z.array(z.string().trim().max(60)).optional(),
});

// --- Comments (plan/07 4.6) ------------------------------------------------

export const commentStatusSchema = z.enum(["open", "resolved"]);

const commentAuthorSchema = z.string().trim().min(1).max(80).optional();
const commentBodySchema = z.string().trim().min(1).max(4000);

export const createCommentSchema = z.object({
  pageId: z.string().trim().min(1).max(120),
  nodeId: z.string().trim().min(1).max(120).optional(),
  nodeLabel: z.string().trim().min(1).max(200).optional(),
  body: commentBodySchema,
  authorName: commentAuthorSchema,
});

export const replyCommentSchema = z.object({
  body: commentBodySchema,
  authorName: commentAuthorSchema,
});

export const updateCommentThreadSchema = z.object({
  status: commentStatusSchema,
});

// --- Assets ----------------------------------------------------------------

export const ASSET_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const uploadAssetSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ASSET_MIME_TYPES),
  // 2 MiB of bytes → at most ~2.8M base64 characters (validated again after
  // decoding so the limit is on the actual payload, not the encoding).
  dataBase64: z.string().min(1).max(3_000_000),
});
