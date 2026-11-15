// ---------------------------------------------------------------------------
// AI responsive optimization (plan/07 3.8).
//
// Proposes safe tablet/mobile overrides without touching the desktop styles.
// The API uses this deterministic analyzer when no model is configured, and as
// a fallback when the model returns invalid JSON. No AI key is required.
//
// Rules:
//  - fixed width / min-width wider than the breakpoint → shrink to 100%
//  - horizontal flex rows on mobile → stack vertically
//  - oversized padding / gap / font-size on mobile → clamp to sane values
//  - properties already overridden for that breakpoint are never proposed again
// ---------------------------------------------------------------------------

import {
  getComponentDefinition,
  walkTree,
  type ComponentDefinition,
  type UiDocument,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import type {
  ResponsiveBreakpoint,
  ResponsiveOptimizeResult,
  ResponsiveSuggestion,
} from "@ai-mockup-studio/shared-types";

const BREAKPOINT_WIDTHS: Record<ResponsiveBreakpoint, number> = {
  tablet: 768,
  mobile: 390,
};

const DEFAULT_BREAKPOINTS: ResponsiveBreakpoint[] = ["tablet", "mobile"];
const MAX_SUGGESTIONS = 60;

/** UiStyles keys a responsive suggestion is allowed to write. */
export const RESPONSIVE_STYLE_KEYS = new Set([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "padding",
  "margin",
  "gap",
  "display",
  "flex",
  "flexDirection",
  "flexWrap",
  "flexShrink",
  "alignItems",
  "justifyContent",
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "borderWidth",
  "borderColor",
  "borderRadius",
  "opacity",
]);

interface RuleHit {
  title: string;
  detail: string;
  styles: Record<string, unknown>;
}

export function heuristicResponsiveOptimization(
  doc: UiDocument,
  breakpoints: ResponsiveBreakpoint[] = DEFAULT_BREAKPOINTS,
): ResponsiveOptimizeResult {
  const suggestions: ResponsiveSuggestion[] = [];

  walkTree(doc.root, (node) => {
    if (node.hidden) return;
    const definition = getComponentDefinition(node.type);

    for (const breakpoint of breakpoints) {
      const existing = node.responsive?.[breakpoint] ?? {};
      // Mirror the renderer: definition defaults → base styles → overrides.
      const effective = {
        ...(definition?.defaultStyles ?? {}),
        ...(node.styles ?? {}),
        ...existing,
      };
      const hits = analyzeNode(node, definition, breakpoint, effective);
      if (hits.length === 0) continue;

      const styles: Record<string, unknown> = {};
      for (const hit of hits) {
        for (const [key, value] of Object.entries(hit.styles)) {
          if (!(key in existing) && !(key in styles)) styles[key] = value;
        }
      }
      if (Object.keys(styles).length === 0) continue;

      suggestions.push({
        id: `responsive:${breakpoint}:${node.id}`,
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: definition?.label ?? node.type,
        breakpoint,
        title: hits[0].title,
        detail: hits.map((hit) => hit.detail).join(" · "),
        styles,
      });
    }
  });

  const tablet = suggestions.filter((s) => s.breakpoint === "tablet").length;
  const mobile = suggestions.filter((s) => s.breakpoint === "mobile").length;
  const summary =
    suggestions.length === 0
      ? "Không phát hiện vấn đề responsive nào. Các breakpoint đang dùng override hợp lý."
      : `Đề xuất ${suggestions.length} thay đổi (${tablet} tablet, ${mobile} mobile). Desktop giữ nguyên.`;

  return {
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    summary,
    source: "heuristic",
  };
}

function analyzeNode(
  node: UiNode,
  definition: ComponentDefinition | undefined,
  breakpoint: ResponsiveBreakpoint,
  effective: Record<string, unknown>,
): RuleHit[] {
  const hits: RuleHit[] = [];
  const viewport = BREAKPOINT_WIDTHS[breakpoint];
  const label = definition?.label ?? node.type;

  // --- Fixed width wider than the viewport --------------------------------
  const width = numericStyle(effective.width);
  if (width !== undefined && width > viewport - 24) {
    const styles: Record<string, unknown> = { width: "100%", minWidth: 0 };
    if (node.type === "basic.image") styles.height = "auto";
    hits.push({
      title: "Chiều rộng cố định vượt khung",
      detail: `${label} rộng ${width}px, lớn hơn khung ${breakpoint} (${viewport}px).`,
      styles,
    });
  }

  // --- Min width wider than the viewport ----------------------------------
  const minWidth = numericStyle(effective.minWidth);
  if (minWidth !== undefined && minWidth > viewport - 24) {
    hits.push({
      title: "Min width vượt khung",
      detail: `${label} có minWidth ${minWidth}px, không vừa khung ${viewport}px.`,
      styles: { minWidth: 0 },
    });
  }

  // --- Horizontal rows on mobile ------------------------------------------
  if (
    breakpoint === "mobile" &&
    definition?.isContainer &&
    node.type !== "layout.navbar" &&
    effective.display === "flex" &&
    effective.flexDirection === "row" &&
    effective.flexWrap !== "wrap" &&
    effective.flexWrap !== "wrap-reverse"
  ) {
    hits.push({
      title: "Hàng ngang nên xếp dọc",
      detail: `${label} đang xếp ngang; trên mobile nên chuyển thành cột để tránh tràn.`,
      styles: { flexDirection: "column" },
    });
  }

  // --- Oversized spacing / typography on mobile ---------------------------
  if (breakpoint === "mobile") {
    const padding = numericStyle(effective.padding);
    if (padding !== undefined && padding > 16) {
      hits.push({
        title: "Padding quá lớn trên mobile",
        detail: `${label} dùng padding ${padding}px; giảm còn 16px để có thêm không gian nội dung.`,
        styles: { padding: 16 },
      });
    }

    const gap = numericStyle(effective.gap);
    if (gap !== undefined && gap > 16) {
      hits.push({
        title: "Khoảng cách quá lớn trên mobile",
        detail: `${label} dùng gap ${gap}px; giảm còn 12px cho nhịp dọc gọn hơn.`,
        styles: { gap: 12 },
      });
    }

    const fontSize = numericStyle(effective.fontSize);
    if (fontSize !== undefined && fontSize > 24) {
      hits.push({
        title: "Cỡ chữ lớn trên mobile",
        detail: `${label} dùng ${fontSize}px; giảm còn 24px để tiêu đề không chiếm quá nhiều dòng.`,
        styles: { fontSize: 24 },
      });
    }
  }

  return hits;
}

/**
 * Build the next immutable document with all suggestions applied as breakpoint
 * overrides. Base styles are never modified.
 */
export function applyResponsiveSuggestions(
  doc: UiDocument,
  suggestions: ResponsiveSuggestion[],
): UiDocument | null {
  if (suggestions.length === 0) return null;
  const patches = suggestions.map((suggestion) => ({
    op: "update" as const,
    targetId: suggestion.nodeId,
    changes: Object.fromEntries(
      Object.entries(suggestion.styles).map(([key, value]) => [
        `responsive.${suggestion.breakpoint}.${key}`,
        value,
      ]),
    ),
  }));
  return applyPatchBatch(doc, patches);
}

/**
 * Validate and normalize model-proposed overrides. Unknown keys and malformed
 * values are dropped so a model can never inject arbitrary styles.
 */
export function sanitizeResponsiveStyles(
  styles: Record<string, unknown>,
): Record<string, unknown> | null {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(styles)) {
    if (!RESPONSIVE_STYLE_KEYS.has(key)) continue;
    const normalized = sanitizeStyleValue(key, value);
    if (normalized !== undefined) clean[key] = normalized;
  }

  return Object.keys(clean).length > 0 ? clean : null;
}

function sanitizeStyleValue(key: string, value: unknown): unknown {
  if (key === "flexDirection") {
    return value === "row" || value === "column" ? value : undefined;
  }
  if (key === "flexWrap") {
    return value === "nowrap" || value === "wrap" || value === "wrap-reverse"
      ? value
      : undefined;
  }
  if (key === "flexShrink" || key === "borderWidth" || key === "opacity") {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0 || text.length > 200) return undefined;
  return text;
}

// --- Helpers ---------------------------------------------------------------

function numericStyle(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (match) return Number(match[1]);
  }
  return undefined;
}
