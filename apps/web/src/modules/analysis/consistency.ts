// ---------------------------------------------------------------------------
// Design consistency check (plan/07 3.10) — deterministic audit of the
// document against the design system scales. Runs locally (no AI key), and
// returns safe style fixes that can be applied through the command manager.
//
// Rules:
//  - spacing: padding/margin/gap must sit on the spacing scale
//  - font-size: explicit sizes must sit on the type scale
//  - radius: border radius must use a radius token (or full)
//  - color: colors must match a theme token; near-duplicates are flagged
//  - font-family: explicit fonts must match the theme font
//  - type-scale: too many distinct font sizes in one document
// ---------------------------------------------------------------------------

import { defaultTokens } from "@ai-mockup-studio/design-system";
import {
  getComponentDefinition,
  type Theme,
  type UiDocument,
  type UiNode,
  type ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";

export type ConsistencyRule =
  | "spacing"
  | "font-size"
  | "radius"
  | "color"
  | "font-family"
  | "type-scale";

export interface ConsistencyIssue {
  /** Stable id for list keys and targeted fixes. */
  id: string;
  rule: ConsistencyRule;
  severity: "warning" | "info";
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  /** The style key that drifted (padding, fontSize, color…). */
  property: string;
  message: string;
  suggestion: string;
  /** Safe style patch that resolves the issue. */
  fixStyles?: Record<string, unknown>;
}

const MAX_FONT_SIZES = 6;
const COLOR_DRIFT_DISTANCE = 40;

/** Token scales derived from the design system (source of truth). */
const SPACING_SCALE = new Set(Object.values(defaultTokens.spacing));
const FONT_SCALE = new Set([
  defaultTokens.typography.fontSizeXs,
  defaultTokens.typography.fontSizeSm,
  defaultTokens.typography.fontSizeBase,
  defaultTokens.typography.fontSizeLg,
  defaultTokens.typography.fontSizeXl,
  defaultTokens.typography.fontSize2xl,
  defaultTokens.typography.fontSize3xl,
  36,
  48,
]);
const RADIUS_SCALE = new Set(Object.values(defaultTokens.radius));
const SPACING_KEYS = ["padding", "margin", "gap"] as const;
const COLOR_KEYS = ["color", "backgroundColor", "borderColor"] as const;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface PaletteToken {
  name: string;
  value: string;
}

export function analyzeConsistency(
  doc: UiDocument,
  viewport: ViewportMode = "desktop",
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const palette = themePalette(doc.theme);
  const explicitFontSizes = new Set<number>();
  const offPaletteColors = new Set<string>();

  const visit = (node: UiNode) => {
    if (node.hidden) return;
    const override = viewport === "desktop" ? undefined : node.responsive?.[viewport];
    const styles: Record<string, unknown> = { ...(node.styles ?? {}), ...(override ?? {}) };
    const definition = getComponentDefinition(node.type);
    const label = definition?.label ?? node.type;

    // --- Spacing scale ---------------------------------------------------
    for (const key of SPACING_KEYS) {
      const value = numericStyle(styles[key]);
      if (value === undefined || value <= 0 || SPACING_SCALE.has(value)) continue;
      const nearest = nearestValue(SPACING_SCALE, value);
      issues.push({
        id: `spacing:${node.id}:${key}`,
        rule: "spacing",
        severity: "warning",
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: label,
        property: key,
        message: `${key} = ${value}px không thuộc thang spacing (${formatScale(SPACING_SCALE)})`,
        suggestion: `Snap về ${nearest}px để giữ nhịp khoảng cách nhất quán.`,
        fixStyles: { [key]: nearest },
      });
    }

    // --- Type scale ------------------------------------------------------
    const fontSize = numericStyle(styles.fontSize);
    if (fontSize !== undefined) {
      explicitFontSizes.add(fontSize);
      if (!FONT_SCALE.has(fontSize)) {
        const nearest = nearestValue(FONT_SCALE, fontSize);
        issues.push({
          id: `font-size:${node.id}`,
          rule: "font-size",
          severity: "warning",
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: label,
          property: "fontSize",
          message: `fontSize = ${fontSize}px không thuộc type scale (${formatScale(FONT_SCALE)})`,
          suggestion: `Dùng ${nearest}px để đồng bộ với hệ thống typography.`,
          fixStyles: { fontSize: nearest },
        });
      }
    }

    // --- Radius tokens ---------------------------------------------------
    const radius = numericStyle(styles.borderRadius);
    if (
      radius !== undefined &&
      radius > 0 &&
      radius < 100 &&
      !RADIUS_SCALE.has(radius)
    ) {
      const nearest = nearestValue(RADIUS_SCALE, radius);
      issues.push({
        id: `radius:${node.id}`,
        rule: "radius",
        severity: "warning",
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: label,
        property: "borderRadius",
        message: `borderRadius = ${radius}px không khớp radius token`,
        suggestion: `Dùng ${nearest}px (radius token gần nhất).`,
        fixStyles: { borderRadius: nearest },
      });
    }

    // --- Font family -----------------------------------------------------
    if (
      typeof styles.fontFamily === "string" &&
      styles.fontFamily.trim() !== doc.theme.fontFamily.trim()
    ) {
      issues.push({
        id: `font-family:${node.id}`,
        rule: "font-family",
        severity: "warning",
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: label,
        property: "fontFamily",
        message: `fontFamily "${styles.fontFamily}" khác theme "${doc.theme.fontFamily}"`,
        suggestion: "Dùng font family của theme để giữ nhận diện thống nhất.",
        fixStyles: { fontFamily: doc.theme.fontFamily },
      });
    }

    // --- Colors ----------------------------------------------------------
    for (const key of COLOR_KEYS) {
      const value = styles[key];
      if (typeof value !== "string") continue;
      const rgb = parseHexColor(value);
      if (!rgb) continue;
      const normalized = normalizeHex(value);
      if (palette.some((token) => token.value === normalized)) continue;

      offPaletteColors.add(normalized);
      const near = nearestPalette(value, palette);
      if (near && near.distance <= COLOR_DRIFT_DISTANCE) {
        issues.push({
          id: `color:${node.id}:${key}`,
          rule: "color",
          severity: "warning",
          nodeId: node.id,
          nodeType: node.type,
          nodeLabel: label,
          property: key,
          message: `${key} ${value} gần token ${near.token.name} (${near.token.value}) nhưng không khớp`,
          suggestion: `Dùng đúng token ${near.token.value} để tránh lệch màu.`,
          fixStyles: { [key]: near.token.value },
        });
      }
    }

    node.children?.forEach(visit);
  };

  visit(doc.root);

  if (explicitFontSizes.size > MAX_FONT_SIZES) {
    issues.push({
      id: "type-scale:too-many",
      rule: "type-scale",
      severity: "info",
      nodeId: doc.root.id,
      nodeType: doc.root.type,
      nodeLabel: "Document",
      property: "fontSize",
      message: `Document dùng ${explicitFontSizes.size} cỡ chữ khác nhau`,
      suggestion: "Gộp các cỡ gần nhau; thang chữ nên giữ khoảng 4–6 bậc.",
    });
  }

  if (offPaletteColors.size > 3) {
    issues.push({
      id: "color:too-many",
      rule: "color",
      severity: "info",
      nodeId: doc.root.id,
      nodeType: doc.root.type,
      nodeLabel: "Document",
      property: "color",
      message: `Có ${offPaletteColors.size} màu nằm ngoài theme token`,
      suggestion: "Đưa màu phụ về token hoặc bổ sung chúng vào design system.",
    });
  }

  return issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

/**
 * Build the next immutable document with all safe fixes applied. Tablet/mobile
 * audits write breakpoint overrides so the desktop layout stays untouched.
 */
export function applyConsistencyFixes(
  doc: UiDocument,
  issues: ConsistencyIssue[],
  viewport: ViewportMode = "desktop",
): UiDocument | null {
  const byNode = new Map<string, Record<string, unknown>>();
  for (const issue of issues) {
    if (!issue.fixStyles) continue;
    byNode.set(issue.nodeId, {
      ...(byNode.get(issue.nodeId) ?? {}),
      ...issue.fixStyles,
    });
  }
  if (byNode.size === 0) return null;

  const patches = [...byNode].map(([targetId, styles]) => {
    if (viewport === "desktop") {
      return { op: "style" as const, targetId, styles };
    }
    return {
      op: "update" as const,
      targetId,
      changes: Object.fromEntries(
        Object.entries(styles).map(([key, value]) => [
          `responsive.${viewport}.${key}`,
          value,
        ]),
      ),
    };
  });
  return applyPatchBatch(doc, patches);
}

// --- Helpers ---------------------------------------------------------------

function severityRank(severity: ConsistencyIssue["severity"]): number {
  return severity === "warning" ? 2 : 1;
}

function numericStyle(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (match) return Number(match[1]);
  }
  return undefined;
}

function nearestValue(values: Set<number>, target: number): number {
  let best = target;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

function formatScale(values: Set<number>): string {
  return [...values]
    .sort((a, b) => a - b)
    .slice(0, 10)
    .join("/");
}

function parseHexColor(value: string): Rgb | null {
  const hex = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1][0] + short[1][0], 16),
      g: parseInt(short[1][1] + short[1][1], 16),
      b: parseInt(short[1][2] + short[1][2], 16),
    };
  }
  const long = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!long) return null;
  return {
    r: parseInt(long[1].slice(0, 2), 16),
    g: parseInt(long[1].slice(2, 4), 16),
    b: parseInt(long[1].slice(4, 6), 16),
  };
}

function normalizeHex(value: string): string {
  const rgb = parseHexColor(value);
  if (!rgb) return value.trim().toLowerCase();
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`.toLowerCase();
}

function themePalette(theme: Theme): PaletteToken[] {
  return [
    { name: "primary", value: theme.primary },
    { name: "primaryForeground", value: theme.primaryForeground },
    { name: "background", value: theme.background },
    { name: "foreground", value: theme.foreground },
    { name: "muted", value: theme.muted },
    { name: "mutedForeground", value: theme.mutedForeground },
    { name: "border", value: theme.border },
  ]
    .map((token) => ({ ...token, value: normalizeHex(token.value) }))
    .filter((token) => parseHexColor(token.value) !== null);
}

function nearestPalette(
  value: string,
  palette: PaletteToken[],
): { token: PaletteToken; distance: number } | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  let best: { token: PaletteToken; distance: number } | null = null;
  for (const token of palette) {
    const tokenRgb = parseHexColor(token.value);
    if (!tokenRgb) continue;
    const distance = Math.sqrt(
      (rgb.r - tokenRgb.r) ** 2 + (rgb.g - tokenRgb.g) ** 2 + (rgb.b - tokenRgb.b) ** 2,
    );
    if (!best || distance < best.distance) best = { token, distance };
  }
  return best;
}
