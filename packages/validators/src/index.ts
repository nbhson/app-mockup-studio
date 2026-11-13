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
    fontSize: z.union([z.number(), z.string()]).optional(),
    fontWeight: z.union([z.number(), z.string()]).optional(),
    borderWidth: z.number().optional(),
    borderColor: z.string().optional(),
    borderRadius: z.number().optional(),
    opacity: z.number().optional(),
  })
  .passthrough();

export const uiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
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
