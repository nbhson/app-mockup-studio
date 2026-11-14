// ---------------------------------------------------------------------------
// Offline design critique (plan/07 3.5).
//
// The API uses this deterministic analyzer when no model is configured, and as
// a fallback when the model keeps returning invalid JSON. It mirrors the rules
// the prompt asks the model to evaluate: hierarchy, spacing, contrast, token
// consistency, accessibility and content quality. No AI key is required.
// ---------------------------------------------------------------------------

import { defaultTokens } from "@ai-mockup-studio/design-system";
import type { UiDocument, UiNode, ViewportMode } from "@ai-mockup-studio/ui-schema";
import { resolveDocument, type ResolvedElement } from "@ai-mockup-studio/ui-renderer";
import type {
  CritiqueFinding,
  CritiqueSeverity,
  DesignCritiqueResult,
} from "@ai-mockup-studio/shared-types";

const MIN_CONTRAST = 4.5;
const MIN_LARGE_CONTRAST = 3;
const MIN_FONT_SIZE = 12;
const MAX_DEPTH = 5;
const MAX_FINDINGS = 12;
const MAX_FONT_SIZES = 6;

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

const PLACEHOLDER_PATTERN = /^(lorem ipsum|todo|tbd|placeholder|sample text|—|-)$/i;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function heuristicCritique(
  doc: UiDocument,
  viewport: ViewportMode = "desktop",
): DesignCritiqueResult {
  const findings: CritiqueFinding[] = [];
  const resolvedRoot = resolveDocument(doc, viewport);
  const resolvedById = new Map<string, ResolvedElement>();
  const index = (element: ResolvedElement) => {
    resolvedById.set(element.id, element);
    element.children?.forEach(index);
  };
  index(resolvedRoot);

  const spacingScale = new Set(Object.values(defaultTokens.spacing));
  const fontScale = new Set([
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
  const palette = themePalette(doc);
  const explicitFontSizes = new Set<number>();
  const offPaletteColors = new Set<string>();
  let maxDepth = 0;
  let prominentHeading = false;

  const walk = (
    node: UiNode,
    depth: number,
    inheritedBackground: string,
    inheritedColor: string,
  ) => {
    if (node.hidden) return;
    const element = resolvedById.get(node.id);
    if (!element) return;

    maxDepth = Math.max(maxDepth, depth);
    const override = viewport === "desktop" ? undefined : node.responsive?.[viewport];
    const explicit: Record<string, unknown> = { ...(node.styles ?? {}), ...(override ?? {}) };

    const background =
      typeof element.styles.backgroundColor === "string"
        ? element.styles.backgroundColor
        : inheritedBackground;
    const color =
      typeof element.styles.color === "string" ? element.styles.color : inheritedColor;

    // --- Contrast ----------------------------------------------------------
    const fontSize =
      numericStyle(explicit.fontSize) ?? numericStyle(element.styles.fontSize) ?? 16;
    const fontWeight = numericStyle(element.styles.fontWeight) ?? 400;
    if (hasText(element) && fontSize >= 20 && fontWeight >= 600) {
      prominentHeading = true;
    }
    if (hasText(element)) {
      const fg = parseHexColor(color);
      const bg = parseHexColor(background);
      if (fg && bg) {
        const ratio = contrastRatio(fg, bg);
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        const required = large ? MIN_LARGE_CONTRAST : MIN_CONTRAST;
        if (ratio < required) {
          findings.push({
            id: `contrast:${node.id}`,
            category: "contrast",
            severity: "high",
            title: "Độ tương phản chưa đạt WCAG AA",
            detail: `${element.label} (${node.id}) có tỉ lệ ${ratio.toFixed(2)}:1, cần tối thiểu ${required}:1.`,
            suggestion: `Đổi màu chữ sang ${bestTextColor(background, doc)} hoặc làm nền sáng/tối hơn.`,
            nodeId: node.id,
            fixStyles: { color: bestTextColor(background, doc) },
          });
        }
      }
    }

    // --- Spacing -----------------------------------------------------------
    for (const key of ["padding", "margin", "gap"]) {
      const value = numericStyle(explicit[key]);
      if (value === undefined || value <= 0 || spacingScale.has(value)) continue;
      const nearest = nearestValue(spacingScale, value);
      findings.push({
        id: `spacing:${node.id}:${key}`,
        category: "spacing",
        severity: "medium",
        title: "Khoảng cách lệch thang spacing",
        detail: `${element.label} (${node.id}) dùng ${key} = ${value}px, không nằm trong thang 4/8/12/16/24/32…`,
        suggestion: `Snap về ${nearest}px để giữ nhịp khoảng cách nhất quán.`,
        nodeId: node.id,
        fixStyles: { [key]: nearest },
      });
    }

    // --- Typography --------------------------------------------------------
    const explicitFontSize = numericStyle(explicit.fontSize);
    if (explicitFontSize !== undefined) {
      explicitFontSizes.add(explicitFontSize);
      if (explicitFontSize < MIN_FONT_SIZE) {
        findings.push({
          id: `font-size-small:${node.id}`,
          category: "accessibility",
          severity: "medium",
          title: "Cỡ chữ quá nhỏ",
          detail: `${element.label} (${node.id}) dùng ${explicitFontSize}px, khó đọc trên nhiều thiết bị.`,
          suggestion: "Tăng lên tối thiểu 12px (khuyến nghị 14px cho nội dung).",
          nodeId: node.id,
          fixStyles: { fontSize: 14 },
        });
      } else if (!fontScale.has(explicitFontSize)) {
        const nearest = nearestValue(fontScale, explicitFontSize);
        findings.push({
          id: `font-size:${node.id}`,
          category: "consistency",
          severity: "low",
          title: "Cỡ chữ ngoài type scale",
          detail: `${element.label} (${node.id}) dùng ${explicitFontSize}px, không thuộc thang chữ của design system.`,
          suggestion: `Dùng ${nearest}px để đồng bộ với các màn hình khác.`,
          nodeId: node.id,
          fixStyles: { fontSize: nearest },
        });
      }
    }
    if (
      typeof explicit.fontFamily === "string" &&
      explicit.fontFamily !== doc.theme.fontFamily
    ) {
      findings.push({
        id: `font-family:${node.id}`,
        category: "consistency",
        severity: "low",
        title: "Font khác với theme",
        detail: `${element.label} (${node.id}) dùng font "${explicit.fontFamily}" thay vì "${doc.theme.fontFamily}".`,
        suggestion: "Dùng font family của theme để giữ nhận diện thống nhất.",
        nodeId: node.id,
        fixStyles: { fontFamily: doc.theme.fontFamily },
      });
    }

    // --- Color drift -------------------------------------------------------
    for (const key of ["color", "backgroundColor", "borderColor"]) {
      const value = explicit[key];
      if (typeof value !== "string") continue;
      const rgb = parseHexColor(value);
      if (!rgb) continue;
      const normalized = normalizeHex(value);
      if (palette.some((token) => token.value === normalized)) continue;
      offPaletteColors.add(normalized);
      const near = nearestPalette(value, palette);
      if (near && near.distance <= 40) {
        findings.push({
          id: `color:${node.id}:${key}`,
          category: "consistency",
          severity: "low",
          title: "Màu gần giống token nhưng không khớp",
          detail: `${element.label} (${node.id}) dùng ${value} cho ${key}; token gần nhất là ${near.token.value} (${near.token.name}).`,
          suggestion: `Dùng đúng token ${near.token.value} để tránh lệch màu giữa các màn hình.`,
          nodeId: node.id,
          fixStyles: { [key]: near.token.value },
        });
      }
    }

    // --- Accessibility -----------------------------------------------------
    if (node.type === "basic.image" && !nonEmpty(element.props.alt)) {
      findings.push({
        id: `missing-alt:${node.id}`,
        category: "accessibility",
        severity: "medium",
        title: "Ảnh thiếu mô tả alt",
        detail: `Ảnh ${node.id} không có nội dung alt nên trình đọc màn hình bỏ qua.`,
        suggestion: "Thêm mô tả nội dung ảnh, hoặc alt rỗng nếu ảnh chỉ để trang trí.",
        nodeId: node.id,
      });
    }
    if (
      (node.type === "basic.button" || node.type === "basic.input") &&
      !["label", "placeholder", "ariaLabel", "aria-label"].some((key) =>
        nonEmpty(element.props[key]),
      )
    ) {
      findings.push({
        id: `missing-label:${node.id}`,
        category: "accessibility",
        severity: "medium",
        title: node.type === "basic.button" ? "Nút thiếu nhãn" : "Trường nhập thiếu nhãn",
        detail: `${element.label} (${node.id}) không có label/placeholder.`,
        suggestion:
          node.type === "basic.button"
            ? "Thêm label mô tả hành động của nút."
            : "Thêm label hoặc placeholder để người dùng biết cần nhập gì.",
        nodeId: node.id,
      });
    }

    // --- Content -----------------------------------------------------------
    for (const key of TEXT_PROPS[node.type] ?? []) {
      const value = element.props[key];
      const texts = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
      if (texts.some((text) => PLACEHOLDER_PATTERN.test(text.trim()))) {
        findings.push({
          id: `content:${node.id}:${key}`,
          category: "content",
          severity: "low",
          title: "Nội dung còn là placeholder",
          detail: `${element.label} (${node.id}) chứa nội dung mẫu "${texts.join(", ")}".`,
          suggestion: "Thay bằng nội dung thật hoặc dữ liệu demo sát ngữ cảnh sản phẩm.",
          nodeId: node.id,
        });
        break;
      }
    }

    for (const child of node.children ?? []) {
      walk(child, depth + 1, background, color);
    }
  };

  walk(doc.root, 0, doc.theme.background, doc.theme.foreground);

  // --- Document-level findings --------------------------------------------
  if (!doc.root.children || doc.root.children.length === 0) {
    findings.push({
      id: "empty-document",
      category: "hierarchy",
      severity: "high",
      title: "Trang chưa có nội dung",
      detail: "Document chỉ có node gốc, chưa có component nào để đánh giá bố cục.",
      suggestion: "Thêm header, nội dung chính và các khối dữ liệu trước khi review.",
      nodeId: doc.root.id,
    });
  }

  if (explicitFontSizes.size > MAX_FONT_SIZES) {
    findings.push({
      id: "type-scale-too-many",
      category: "consistency",
      severity: "low",
      title: "Quá nhiều cỡ chữ",
      detail: `Document dùng ${explicitFontSizes.size} cỡ chữ khác nhau; thang chữ nên giữ khoảng 4–6 bậc.`,
      suggestion: "Gộp các cỡ gần nhau về type scale (12/14/16/20/24/30).",
      nodeId: doc.root.id,
    });
  }

  if (offPaletteColors.size > 3) {
    findings.push({
      id: "palette-too-many",
      category: "consistency",
      severity: "low",
      title: "Bảng màu phân tán",
      detail: `Có ${offPaletteColors.size} màu nằm ngoài theme token.`,
      suggestion: "Đưa các màu phụ về token hoặc thêm chúng vào design system một cách có chủ đích.",
      nodeId: doc.root.id,
    });
  }

  if (maxDepth > MAX_DEPTH) {
    findings.push({
      id: "nesting-too-deep",
      category: "hierarchy",
      severity: "low",
      title: "Cấu trúc lồng quá sâu",
      detail: `Cây component sâu ${maxDepth} cấp; càng sâu càng khó bảo trì và dễ vỡ layout responsive.`,
      suggestion: "Tách các khối lớn thành component/section riêng và giảm nesting không cần thiết.",
      nodeId: doc.root.id,
    });
  }

  if (!prominentHeading && (doc.root.children?.length ?? 0) > 0) {
    findings.push({
      id: "missing-visual-anchor",
      category: "hierarchy",
      severity: "medium",
      title: "Thiếu điểm nhấn thị giác",
      detail: "Không tìm thấy tiêu đề nổi bật (font ≥ 20px, weight ≥ 600) để dẫn mắt người dùng.",
      suggestion: "Thêm page title hoặc dashboard header với cỡ chữ/độ đậm lớn hơn nội dung.",
      nodeId: doc.root.id,
    });
  }

  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const score = designScore(findings);
  return {
    score,
    summary: buildSummary(findings, score),
    findings: findings.slice(0, MAX_FINDINGS),
    source: "heuristic",
  };
}

// --- Scoring / summary -----------------------------------------------------

function severityRank(severity: CritiqueSeverity): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function designScore(findings: CritiqueFinding[]): number {
  const penalty = findings.reduce((total, finding) => {
    if (finding.severity === "high") return total + 12;
    if (finding.severity === "medium") return total + 5;
    return total + 2;
  }, 0);
  return Math.max(10, Math.min(100, 100 - penalty));
}

function buildSummary(findings: CritiqueFinding[], score: number): string {
  if (findings.length === 0) {
    return "Không phát hiện vấn đề lớn. Bố cục, tương phản và việc dùng design token khá nhất quán.";
  }
  const high = findings.filter((finding) => finding.severity === "high").length;
  const medium = findings.filter((finding) => finding.severity === "medium").length;
  const top = findings
    .slice(0, 2)
    .map((finding) => finding.title.toLowerCase())
    .join(", ");
  const verdict =
    score >= 80
      ? "Tổng thể đã khá tốt, chỉ cần tinh chỉnh thêm."
      : score >= 60
        ? "Nền tảng ổn nhưng còn vài điểm ảnh hưởng đến chất lượng cảm nhận."
        : "Cần xử lý các vấn đề chính trước khi coi là bản hoàn thiện.";
  return `Điểm thiết kế ${score}/100. Phát hiện ${findings.length} vấn đề (${high} nghiêm trọng, ${medium} trung bình). Ưu tiên: ${top}. ${verdict}`;
}

// --- Helpers ---------------------------------------------------------------

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasText(element: ResolvedElement): boolean {
  const keys = TEXT_PROPS[element.type];
  if (!keys) return false;
  return keys.some((key) => {
    const value = element.props[key];
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) {
      return value.some((item) => String(item ?? "").trim().length > 0);
    }
    return false;
  });
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

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

interface PaletteToken {
  name: string;
  value: string;
}

function themePalette(doc: UiDocument): PaletteToken[] {
  return [
    { name: "primary", value: doc.theme.primary },
    { name: "primaryForeground", value: doc.theme.primaryForeground },
    { name: "background", value: doc.theme.background },
    { name: "foreground", value: doc.theme.foreground },
    { name: "muted", value: doc.theme.muted },
    { name: "mutedForeground", value: doc.theme.mutedForeground },
    { name: "border", value: doc.theme.border },
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

function bestTextColor(background: string, doc: UiDocument): string {
  const bg = parseHexColor(background);
  if (!bg) return doc.theme.foreground;
  const candidates = [
    doc.theme.foreground,
    doc.theme.background,
    doc.theme.primaryForeground,
    "#000000",
    "#FFFFFF",
  ];
  let best = doc.theme.foreground;
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
