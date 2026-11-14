// ---------------------------------------------------------------------------
// Accessibility analysis (plan/07 3.6) — deterministic, rule-based checks over
// the resolved document. Runs locally (no AI key required) and produces safe
// style fixes that are applied through the normal command manager.
//
// Rules covered:
//  - contrast: WCAG 2.1 AA text/background ratio (4.5:1, 3:1 for large text)
//  - missing-alt: images without an alt description
//  - missing-label: buttons/inputs without any label or placeholder
//  - small-text: explicit font sizes below 12px
//  - small-target: buttons/inputs smaller than 32px on either axis
// ---------------------------------------------------------------------------

import type { Theme, UiDocument, ViewportMode } from "@ai-mockup-studio/ui-schema";
import {
  applyPatchBatch,
  resolveDocument,
  type ResolvedElement,
} from "@ai-mockup-studio/ui-renderer";

export type AccessibilityRule =
  | "contrast"
  | "missing-alt"
  | "missing-label"
  | "small-text"
  | "small-target";

export interface AccessibilityIssue {
  /** Stable id (`rule:nodeId`) for list keys and targeted fixes. */
  id: string;
  rule: AccessibilityRule;
  severity: "error" | "warning";
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  message: string;
  suggestion: string;
  /** Safe style patch that resolves the issue (contrast/text/target). */
  fixStyles?: Record<string, unknown>;
}

const MIN_CONTRAST = 4.5;
const MIN_LARGE_CONTRAST = 3;
const MIN_FONT_SIZE = 12;
const FIX_FONT_SIZE = 14;
const MIN_TARGET = 32;
const FIX_TARGET = 32;

/** Component types that render user-visible text, and which props hold it. */
const TEXT_PROPS: Record<string, string[]> = {
  "basic.text": ["text"],
  "basic.button": ["label"],
  "basic.input": ["label", "placeholder"],
  "dashboard.header": ["title", "subtitle"],
  "dashboard.chart": ["title"],
  "dashboard.table": ["headers"],
  "dashboard.stats": ["items"],
  "formal.card": ["title"],
  "formal.form": ["title"],
};

export function analyzeAccessibility(
  doc: UiDocument,
  viewport: ViewportMode = "desktop",
): AccessibilityIssue[] {
  const resolved = resolveDocument(doc, viewport);
  const issues: AccessibilityIssue[] = [];

  const visit = (
    el: ResolvedElement,
    inheritedBackground: string,
    inheritedColor: string,
  ) => {
    if (el.hidden) return;

    const styles = el.styles;
    const background =
      typeof styles.backgroundColor === "string"
        ? styles.backgroundColor
        : inheritedBackground;
    const color =
      typeof styles.color === "string" ? styles.color : inheritedColor;

    checkContrast(el, color, background, doc.theme, issues);
    checkMissingAlt(el, issues);
    checkMissingLabel(el, issues);
    checkSmallText(el, issues);
    checkSmallTarget(el, issues);

    for (const child of el.children ?? []) {
      visit(child, background, color);
    }
  };

  visit(resolved, doc.theme.background, doc.theme.foreground);
  return issues;
}

/**
 * Build the next immutable document with all safe fixes applied. Returns null
 * when there is nothing to fix (only manual issues such as missing alt text).
 */
export function applyAccessibilityFixes(
  doc: UiDocument,
  issues: AccessibilityIssue[],
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
  return applyPatchBatch(
    doc,
    [...byNode].map(([targetId, styles]) => ({
      op: "style" as const,
      targetId,
      styles,
    })),
  );
}

// --- Rules -----------------------------------------------------------------

function checkContrast(
  el: ResolvedElement,
  color: string,
  background: string,
  theme: Theme,
  issues: AccessibilityIssue[],
) {
  if (!hasText(el)) return;
  const fg = parseHexColor(color);
  const bg = parseHexColor(background);
  if (!fg || !bg) return;

  const ratio = contrastRatio(fg, bg);
  const fontSize = numericStyle(el.styles.fontSize) ?? 16;
  const bold =
    numericStyle(el.styles.fontWeight) !== undefined
      ? Number(el.styles.fontWeight) >= 700
      : false;
  const large = fontSize >= 24 || (fontSize >= 18.66 && bold);
  const required = large ? MIN_LARGE_CONTRAST : MIN_CONTRAST;
  if (ratio >= required) return;

  const fixed = bestTextColor(background, theme);
  issues.push({
    id: `contrast:${el.id}`,
    rule: "contrast",
    severity: "error",
    nodeId: el.id,
    nodeType: el.type,
    nodeLabel: el.label,
    message: `Độ tương phản ${ratio.toFixed(2)}:1 (cần ≥ ${required}:1)`,
    suggestion: `Đổi màu chữ sang ${fixed} để đạt ngưỡng WCAG AA.`,
    fixStyles: { color: fixed },
  });
}

function checkMissingAlt(el: ResolvedElement, issues: AccessibilityIssue[]) {
  if (el.type !== "basic.image") return;
  const alt = el.props.alt;
  if (typeof alt === "string" && alt.trim().length > 0) return;
  issues.push({
    id: `missing-alt:${el.id}`,
    rule: "missing-alt",
    severity: "warning",
    nodeId: el.id,
    nodeType: el.type,
    nodeLabel: el.label,
    message: "Ảnh thiếu mô tả alt",
    suggestion: "Mô tả nội dung ảnh hoặc đặt alt rỗng nếu ảnh chỉ trang trí.",
  });
}

function checkMissingLabel(el: ResolvedElement, issues: AccessibilityIssue[]) {
  if (el.type !== "basic.button" && el.type !== "basic.input") return;
  const candidates = ["label", "placeholder", "ariaLabel", "aria-label"];
  const labelled = candidates.some((key) => {
    const value = el.props[key];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (labelled) return;
  issues.push({
    id: `missing-label:${el.id}`,
    rule: "missing-label",
    severity: "warning",
    nodeId: el.id,
    nodeType: el.type,
    nodeLabel: el.label,
    message:
      el.type === "basic.button" ? "Nút thiếu nhãn" : "Trường nhập thiếu nhãn",
    suggestion:
      el.type === "basic.button"
        ? "Thêm prop label mô tả hành động của nút."
        : "Thêm label hoặc placeholder để người dùng biết cần nhập gì.",
  });
}

function checkSmallText(el: ResolvedElement, issues: AccessibilityIssue[]) {
  if (!hasText(el)) return;
  const fontSize = numericStyle(el.styles.fontSize);
  if (fontSize === undefined || fontSize >= MIN_FONT_SIZE) return;
  issues.push({
    id: `small-text:${el.id}`,
    rule: "small-text",
    severity: "warning",
    nodeId: el.id,
    nodeType: el.type,
    nodeLabel: el.label,
    message: `Cỡ chữ ${fontSize}px nhỏ hơn ${MIN_FONT_SIZE}px`,
    suggestion: `Tăng cỡ chữ lên ${FIX_FONT_SIZE}px để dễ đọc.`,
    fixStyles: { fontSize: FIX_FONT_SIZE },
  });
}

function checkSmallTarget(el: ResolvedElement, issues: AccessibilityIssue[]) {
  if (el.type !== "basic.button" && el.type !== "basic.input") return;
  const width = numericStyle(el.styles.width);
  const height = numericStyle(el.styles.height);
  const tooSmall =
    (width !== undefined && width < MIN_TARGET) ||
    (height !== undefined && height < MIN_TARGET);
  if (!tooSmall) return;

  const fixStyles: Record<string, unknown> = {};
  if (width !== undefined && width < MIN_TARGET) fixStyles.width = FIX_TARGET;
  if (height !== undefined && height < MIN_TARGET) fixStyles.height = FIX_TARGET;

  const size = [width, height]
    .map((value) => (value === undefined ? "auto" : `${value}px`))
    .join(" × ");
  issues.push({
    id: `small-target:${el.id}`,
    rule: "small-target",
    severity: "warning",
    nodeId: el.id,
    nodeType: el.type,
    nodeLabel: el.label,
    message: `Vùng bấm ${size} nhỏ hơn ${MIN_TARGET}px`,
    suggestion: `Tăng kích thước lên tối thiểu ${FIX_TARGET}px.`,
    fixStyles,
  });
}

// --- Helpers ---------------------------------------------------------------

function hasText(el: ResolvedElement): boolean {
  const keys = TEXT_PROPS[el.type];
  if (!keys) return false;
  return keys.some((key) => {
    const value = el.props[key];
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) {
      return value.some((item) => String(item ?? "").trim().length > 0);
    }
    return false;
  });
}

/** Read a numeric style value (number or "Npx"). */
function numericStyle(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    if (match) return Number(match[1]);
  }
  return undefined;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
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

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick the theme color with the highest contrast against the background. */
function bestTextColor(background: string, theme: Theme): string {
  const bg = parseHexColor(background);
  if (!bg) return theme.foreground;
  const candidates = [
    theme.foreground,
    theme.background,
    theme.primaryForeground,
    "#000000",
    "#FFFFFF",
  ];
  let best = theme.foreground;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const rgb = parseHexColor(candidate);
    if (!rgb) continue;
    const ratio = contrastRatio(rgb, bg);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best.toUpperCase();
}
