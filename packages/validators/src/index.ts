import { z } from "zod";
import type { UiNode } from "@ai-mockup-studio/ui-schema";

// ---------------------------------------------------------------------------
// Zod schemas — runtime validation for UI schema, patches & API bodies.
// (plan/08: `validators` package is used by BOTH web and api.)
// ---------------------------------------------------------------------------

/**
 * Length/scale properties that the renderer treats as numbers (px or unitless).
 *
 * Models — and hand-edited JSON — write CSS as a string: `"borderRadius":
 * "24px"`, `"opacity": "0.9"`. That used to fail validation with dozens of
 * "expected number, received string" issues, which burned every AI retry and
 * landed the user on the offline mockup. Strip the unit and coerce instead of
 * rejecting an otherwise correct document; anything that is not a number
 * ("large", "1rem") still fails, so real mistakes are not hidden.
 */
const cssNumberSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else {
    const match = /^\s*(-?\d+(?:\.\d+)?)(?:px|%)?\s*$/.exec(value);
    if (match) return Number(match[1]);
  }
  ctx.addIssue({
    code: "custom",
    message: `Cần một số (12 hoặc "12px"), nhận được: ${JSON.stringify(value)}`,
  });
});

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
    gridTemplateColumns: z.string().optional(),
    flex: z.union([z.number(), z.string()]).optional(),
    flexDirection: z.enum(["row", "column"]).optional(),
    flexWrap: z.enum(["nowrap", "wrap", "wrap-reverse"]).optional(),
    flexShrink: cssNumberSchema.optional(),
    alignItems: z.string().optional(),
    justifyContent: z.string().optional(),
    backgroundColor: z.string().optional(),
    color: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: z.union([z.number(), z.string()]).optional(),
    fontWeight: z.union([z.number(), z.string()]).optional(),
    borderWidth: cssNumberSchema.optional(),
    borderColor: z.string().optional(),
    borderRadius: cssNumberSchema.optional(),
    opacity: cssNumberSchema.optional(),
  })
  .passthrough();

const responsiveStylesSchema = z
  .object({
    tablet: uiStylesSchema.optional(),
    mobile: uiStylesSchema.optional(),
  })
  .passthrough();

// --- Tree sanity -----------------------------------------------------------
// Recursive Zod parsing overflows the stack on pathological input (LLMs do
// emit runaway nesting on hallucination). Bound depth & node count with an
// ITERATIVE pre-pass, and reject cyclic object graphs outright.

export const MAX_TREE_DEPTH = 200;
export const MAX_TREE_NODES = 5000;

function assertTreeWithinLimits(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  // Accept either a UiNode or a whole UiDocument (walk its .root).
  let node: Record<string, unknown> | null = null;
  if (typeof record.id === "string" && typeof record.type === "string") node = record;
  else if (typeof record.root === "object" && record.root !== null) {
    const root = record.root as Record<string, unknown>;
    if (typeof root.id === "string") node = root;
  }
  if (!node) return data; // let the inner schema report shape errors
  const seen = new Set<unknown>();
  const stack: Array<{ node: Record<string, unknown>; depth: number }> = [{ node, depth: 1 }];
  let count = 0;
  let maxDepth = 1;
  while (stack.length > 0) {
    const entry = stack.pop() as { node: Record<string, unknown>; depth: number };
    if (seen.has(entry.node)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["root"],
          message: "Cây tài liệu chứa tham chiếu vòng lặp (cycle)",
        },
      ]);
    }
    seen.add(entry.node);
    count += 1;
    maxDepth = Math.max(maxDepth, entry.depth);
    if (count > MAX_TREE_NODES || maxDepth > MAX_TREE_DEPTH) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["root"],
          message: `Tài liệu vượt giới hạn cho phép (tối đa ${MAX_TREE_NODES} node, độ sâu ${MAX_TREE_DEPTH})`,
        },
      ]);
    }
    const children = entry.node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === "object" && child !== null) {
          stack.push({ node: child as Record<string, unknown>, depth: entry.depth + 1 });
        }
      }
    }
  }
  return data;
}

// --- Update-patch change keys ----------------------------------------------
// Keys are dot-paths resolved against the node object. Mirror the renderer's
// whitelist so malformed AI patches are rejected BEFORE application.

const SAFE_CHANGE_ROOTS = new Set([
  "props",
  "styles",
  "responsive",
  "name",
  "hidden",
  "locked",
  "text",
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafeChangeKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length === 0 || !SAFE_CHANGE_ROOTS.has(parts[0])) return false;
  return parts.every((part) => !FORBIDDEN_PATH_SEGMENTS.has(part));
}

const _uiNodeSchemaCore: z.ZodType<UiNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
    responsive: responsiveStylesSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    styles: uiStylesSchema.optional(),
    children: z.array(_uiNodeSchemaCore).optional(),
  }),
);

export const uiNodeSchema: z.ZodType<UiNode> = z.preprocess(
  assertTreeWithinLimits,
  _uiNodeSchemaCore,
);

export const viewportSchema = z.object({
  width: z.number(),
  height: z.number(),
});

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]+)$/i;

export const themeSchema = z.object({
  mode: z.enum(["light", "dark"]),
  primary: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  primaryForeground: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  background: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  foreground: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  muted: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  mutedForeground: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  border: z.string().regex(CSS_COLOR_RE, "Màu phải là giá trị CSS hợp lệ").max(64),
  fontFamily: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9 ,'"()-]+$/, "Font family chỉ gồm tên font, dấu phẩy và dấu nháy"),
  radius: z.number(),
});

const uiDocumentSchemaBase = z
  .object({
    schemaVersion: z.string(),
    id: z.string().min(1),
    pageId: z.string().min(1),
    name: z.string().min(1).max(200),
    viewport: viewportSchema,
    theme: themeSchema,
    root: uiNodeSchema,
  })
  .superRefine((doc, ctx) => {
    // Duplicate node ids make every later lookup ambiguous: the two findNode
    // paths (validation vs mutation) can then target different nodes and
    // undo/replay becomes inconsistent. Enforce uniqueness at the boundary.
    const seen = new Set<string>();
    const stack: UiNode[] = [doc.root];
    while (stack.length > 0) {
      const node = stack.pop() as UiNode;
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["root"],
          message: `Node id "${node.id}" xuất hiện nhiều lần — id phải duy nhất trong tài liệu`,
        });
        continue;
      }
      seen.add(node.id);
      for (const child of node.children ?? []) stack.push(child);
    }
  });

// The tree-limit pre-pass lives at the OUTERMOST layer so `safeParse` on a
// pathological document yields a normal result error (a throw inside a nested
// field escapes safeParse's catch and surfaces as an exception).
export const uiDocumentSchema = z.preprocess(assertTreeWithinLimits, uiDocumentSchemaBase);

// --- Patches ---------------------------------------------------------------

export const addPatchSchema = z.object({
  op: z.literal("add"),
  parentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
  node: uiNodeSchema,
});

export const updatePatchSchema = z.object({
  op: z.literal("update"),
  targetId: z.string().min(1),
  changes: z
    .record(z.string(), z.unknown())
    .superRefine((changes, ctx) => {
      for (const key of Object.keys(changes)) {
        if (!isSafeChangeKey(key)) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message:
              'Key của changes phải bắt đầu bằng props./styles./responsive. hoặc là name/hidden/locked/text',
          });
        }
      }
    }),
});

export const removePatchSchema = z.object({
  op: z.literal("remove"),
  targetId: z.string().min(1),
});

export const movePatchSchema = z
  .object({
    op: z.literal("move"),
    targetId: z.string().min(1),
    newParentId: z.string().min(1),
    index: z.number().int().min(0).optional(),
  })
  .superRefine((patch, ctx) => {
    if (patch.newParentId === patch.targetId) {
      ctx.addIssue({
        code: "custom",
        path: ["newParentId"],
        message: "Không thể di chuyển một node vào chính nó",
      });
    }
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

// --- Role-based access control (plan/07 4.5) -------------------------------

export const projectRoleSchema = z.enum(["admin", "editor", "viewer"]);

export const addProjectMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: projectRoleSchema,
});

export const updateProjectMemberRoleSchema = z.object({
  role: projectRoleSchema,
});

// --- Organization workspace (plan/07 4.11) ---------------------------------

export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, "Tên tổ chức không được để trống")
  .max(100);

export const createOrganizationSchema = z.object({
  name: organizationNameSchema,
});

export const updateOrganizationSchema = z.object({
  name: organizationNameSchema.optional(),
});

export const organizationMemberRoleSchema = z.enum(["admin", "member"]);

export const addOrganizationMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: organizationMemberRoleSchema,
});

export const updateOrganizationMemberRoleSchema = z.object({
  role: organizationMemberRoleSchema,
});

export const transferProjectSchema = z.object({
  organizationId: z.string().uuid().nullable(),
});

// --- Plugin ecosystem (plan/07 4.10) ---------------------------------------
// The manifest `main` source is compiled lazily in a sandbox; we validate the
// declared shape here but never execute user-controlled code via validation.

export const pluginPermissionSchema = z.enum(["read", "write"]);

export const pluginManifestSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(32),
  description: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
  apiVersion: z.number().int().positive(),
  permissions: z.array(pluginPermissionSchema).min(1),
  main: z.string().trim().min(1),
});

export const runPluginSchema = z.object({
  selection: z.unknown().optional(),
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
