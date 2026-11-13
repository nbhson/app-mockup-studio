// ---------------------------------------------------------------------------
// Code export (plan/07 4.1 — Export React / Vue / HTML).
//
// The exported code is generated from the SAME resolved tree the canvas renders
// (`resolveNode`), so it never evaluates AI-provided HTML/JS. Every text/attribute
// is escaped, and inline images can be embedded as data URLs so a single
// downloaded file is self-contained.
// ---------------------------------------------------------------------------

import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { resolveNode, type ResolvedElement } from "./index";

export type CodeTarget = "html" | "react" | "vue";

export interface ExportCodeOptions {
  /** Map of original image URL → data URL, so exports work offline. */
  assetMap?: Record<string, string>;
  /** Used to absolutize relative asset URLs that are not in `assetMap`. */
  baseUrl?: string;
}

interface CodeNode {
  tag: string;
  /** CSS properties in camelCase, values already include units. */
  style: Record<string, string>;
  attrs: Record<string, string>;
  text?: string;
  children: CodeNode[];
}

const VOID_TAGS = new Set(["img", "input", "br", "hr"]);

// --- Shared helpers ---------------------------------------------------------

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function px(value: unknown): string | undefined {
  if (typeof value === "number") return `${value}px`;
  return str(value);
}

function baseStyles(el: ResolvedElement): Record<string, string> {
  const raw = el.styles;
  const s: Record<string, string> = {};
  const dim = (key: string) => px(raw[key]);
  const set = (key: string, value: string | undefined) => {
    if (value !== undefined) s[key] = value;
  };

  set("width", dim("width"));
  set("height", dim("height"));
  set("minWidth", dim("minWidth"));
  set("minHeight", dim("minHeight"));
  set("padding", dim("padding"));
  set("margin", dim("margin"));
  set("gap", dim("gap"));
  set("display", str(raw.display));
  if (raw.flex !== undefined) s.flex = String(raw.flex);
  set("flexDirection", str(raw.flexDirection));
  set("flexWrap", str(raw.flexWrap));
  if (raw.flexShrink !== undefined) s.flexShrink = String(raw.flexShrink);
  set("alignItems", str(raw.alignItems));
  set("justifyContent", str(raw.justifyContent));
  set("backgroundColor", str(raw.backgroundColor));
  set("color", str(raw.color));
  set("fontSize", px(raw.fontSize));
  if (raw.fontWeight !== undefined) s.fontWeight = String(raw.fontWeight);
  set("borderRadius", px(raw.borderRadius));
  set("borderColor", str(raw.borderColor));
  if (raw.borderWidth !== undefined) s.borderWidth = `${raw.borderWidth}px`;
  if (raw.opacity !== undefined) s.opacity = String(raw.opacity);

  return s;
}

function resolveImageSrc(src: string, options: ExportCodeOptions): string {
  if (!src) return "";
  const mapped = options.assetMap?.[src];
  if (mapped) return mapped;
  if (src.startsWith("/") && options.baseUrl) {
    return `${options.baseUrl.replace(/\/$/, "")}${src}`;
  }
  return src;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Vue templates must not treat user text containing `{{` as interpolation. */
function escapeVueText(value: string): string {
  return escapeHtml(value).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

function pascalCase(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  const name = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  if (!name) return "Mockup";
  return /^[0-9]/.test(name) ? `Mockup${name}` : name;
}

function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

// --- Schema → framework-neutral code tree -----------------------------------

function buildTree(el: ResolvedElement, options: ExportCodeOptions): CodeNode {
  const base = baseStyles(el);
  const children = (el.children ?? []).map((child) => buildTree(child, options));

  switch (el.type) {
    case "basic.button":
      return {
        tag: "button",
        style: {
          ...base,
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: base.fontSize ?? "14px",
          fontWeight: base.fontWeight ?? "500",
          ...(el.props.disabled ? { opacity: "0.5", cursor: "not-allowed" } : {}),
        },
        attrs: {
          type: "button",
          ...(el.props.disabled ? { disabled: "true" } : {}),
        },
        text: String(el.props.label ?? ""),
        children: [],
      };

    case "basic.input":
      return {
        tag: "input",
        style: {
          ...base,
          width: base.width ?? "100%",
          padding: base.padding ?? "0 12px",
          border: base.borderWidth
            ? `${base.borderWidth} solid ${base.borderColor ?? "#e2e8f0"}`
            : "1px solid #e2e8f0",
          boxSizing: "border-box",
          fontSize: base.fontSize ?? "14px",
        },
        attrs: {
          type: String(el.props.type ?? "text"),
          placeholder: String(el.props.placeholder ?? ""),
        },
        children: [],
      };

    case "basic.image":
      return {
        tag: "img",
        style: {
          ...base,
          width: base.width ?? "100%",
          objectFit: "cover",
        },
        attrs: {
          src: resolveImageSrc(String(el.props.src ?? ""), options),
          alt: String(el.props.alt ?? ""),
        },
        children: [],
      };

    case "basic.text":
      return {
        tag: "div",
        style: base,
        attrs: {},
        text: String(el.props.text ?? ""),
        children: [],
      };

    case "dashboard.header": {
      const title: CodeNode = {
        tag: "div",
        style: {
          fontWeight: base.fontWeight ?? "700",
          fontSize: base.fontSize ?? "24px",
          ...(base.color ? { color: base.color } : {}),
        },
        attrs: {},
        text: String(el.props.title ?? ""),
        children: [],
      };
      const subtitle = el.props.subtitle
        ? [
            {
              tag: "div",
              style: { fontSize: "14px", color: "#64748b", marginTop: "4px" },
              attrs: {},
              text: String(el.props.subtitle),
              children: [],
            } satisfies CodeNode,
          ]
        : [];
      return { tag: "div", style: base, attrs: {}, children: [title, ...subtitle] };
    }

    case "dashboard.stats": {
      const items = Array.isArray(el.props.items)
        ? (el.props.items as unknown[]).slice(0, 4)
        : [];
      const values = Array.isArray(el.props.values)
        ? (el.props.values as unknown[])
        : [];
      const cards: CodeNode[] = items.map((item, index) => {
        const label: CodeNode = {
          tag: "div",
          style: { fontSize: "12px", color: "#64748b" },
          attrs: {},
          text: String(item),
          children: [],
        };
        const value: CodeNode = {
          tag: "div",
          style: {
            marginTop: "4px",
            fontSize: "20px",
            fontWeight: "700",
            color: "#0f172a",
          },
          attrs: {},
          text: values[index] !== undefined ? String(values[index]) : "—",
          children: [],
        };
        return {
          tag: "div",
          style: {
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
            padding: "12px",
          },
          attrs: {},
          children: [label, value],
        };
      });
      return {
        tag: "div",
        style: { display: "grid", gap: base.gap ?? "12px", ...base },
        attrs: {},
        children: cards,
      };
    }

    case "dashboard.chart": {
      const bars = [40, 65, 50, 80, 60, 90, 55].map<CodeNode>((height) => ({
        tag: "div",
        style: {
          width: "100%",
          height: `${height}%`,
          borderRadius: "2px",
          backgroundColor: "#3b82f6",
        },
        attrs: {},
        children: [],
      }));
      return {
        tag: "div",
        style: {
          ...base,
          display: "flex",
          flexDirection: "column",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          backgroundColor: "#ffffff",
          padding: "12px",
        },
        attrs: {},
        children: [
          {
            tag: "span",
            style: { fontSize: "12px", color: "#64748b" },
            attrs: {},
            text: String(el.props.title ?? ""),
            children: [],
          },
          {
            tag: "div",
            style: {
              marginTop: "8px",
              display: "flex",
              flex: "1",
              alignItems: "flex-end",
              gap: "4px",
            },
            attrs: {},
            children: bars,
          },
        ],
      };
    }

    case "dashboard.table": {
      const headers = Array.isArray(el.props.headers)
        ? (el.props.headers as unknown[]).map(String)
        : [];
      const rows = Array.isArray(el.props.rows)
        ? (el.props.rows as unknown[][]).map((row) => (Array.isArray(row) ? row : [row]))
        : [];
      const cellStyle = { padding: "8px 12px" };
      const headRow: CodeNode = {
        tag: "tr",
        style: { backgroundColor: "#f8fafc", textAlign: "left" },
        attrs: {},
        children: headers.map((header) => ({
          tag: "th",
          style: {
            ...cellStyle,
            fontWeight: "500",
            color: "#64748b",
            textAlign: "left",
          },
          attrs: {},
          text: header,
          children: [],
        })),
      };
      const bodyRows: CodeNode[] = rows.map((row) => ({
        tag: "tr",
        style: { borderTop: "1px solid #e2e8f0" },
        attrs: {},
        children: row.map((cell) => ({
          tag: "td",
          style: { ...cellStyle },
          attrs: {},
          text: String(cell),
          children: [],
        })),
      }));
      return {
        tag: "table",
        style: {
          ...base,
          width: base.width ?? "100%",
          borderCollapse: "collapse",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          fontSize: base.fontSize ?? "14px",
          textAlign: "left",
        },
        attrs: {},
        children: [
          { tag: "thead", style: {}, attrs: {}, children: [headRow] },
          { tag: "tbody", style: {}, attrs: {}, children: bodyRows },
        ],
      };
    }

    case "formal.form":
      return { tag: "form", style: base, attrs: {}, children };

    default:
      break;
  }

  if (!el.known) {
    return {
      tag: "div",
      style: {
        ...base,
        border: "1px dashed #fdba74",
        backgroundColor: "#fff7ed",
        padding: "8px",
        fontSize: "12px",
        color: "#ea580c",
      },
      attrs: {},
      text: `${el.type} (chưa hỗ trợ)`,
      children: [],
    };
  }

  return { tag: "div", style: base, attrs: {}, children };
}

function buildRoot(doc: UiDocument, options: ExportCodeOptions): CodeNode {
  return buildTree(resolveNode(doc.root, doc.theme), options);
}

// --- HTML -------------------------------------------------------------------

function htmlStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([key, value]) => `${kebabCase(key)}:${value}`)
    .join(";");
}

function renderHtmlNode(node: CodeNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const attrs = [
    htmlStyle(node.style) ? `style="${escapeHtml(htmlStyle(node.style))}"` : "",
    ...Object.entries(node.attrs)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}="${escapeHtml(value)}"`),
  ]
    .filter(Boolean)
    .join(" ");

  const open = attrs ? `<${node.tag} ${attrs}` : `<${node.tag}`;

  if (VOID_TAGS.has(node.tag)) return `${pad}${open} />`;

  if (node.text !== undefined && node.children.length === 0) {
    return `${pad}${open}>${escapeHtml(node.text)}</${node.tag}>`;
  }

  if (node.children.length === 0 && node.text === undefined) {
    return `${pad}${open}></${node.tag}>`;
  }

  const inner = [
    ...(node.text !== undefined ? [`${"  ".repeat(indent + 1)}${escapeHtml(node.text)}`] : []),
    ...node.children.map((child) => renderHtmlNode(child, indent + 1)),
  ].join("\n");

  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`;
}

export function exportDocumentToHtml(
  doc: UiDocument,
  options: ExportCodeOptions = {},
): string {
  const root = buildRoot(doc, options);
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.name)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; background: ${escapeHtml(doc.theme.background)}; color: ${escapeHtml(doc.theme.foreground)}; font-family: ${escapeHtml(doc.theme.fontFamily)}, system-ui, sans-serif; }
  </style>
</head>
<body>
${renderHtmlNode(root, 1)}
</body>
</html>
`;
}

// --- React ------------------------------------------------------------------

function jsxStyle(style: Record<string, string>): string {
  const entries = Object.entries(style).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

function renderJsxNode(node: CodeNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const attrs = [
    `style={${jsxStyle(node.style)}}`,
    ...Object.entries(node.attrs).map(([key, value]) => {
      if (value === "true") return key;
      return `${key}={${JSON.stringify(value)}}`;
    }),
  ].join(" ");

  if (VOID_TAGS.has(node.tag)) return `${pad}<${node.tag} ${attrs} />`;

  if (node.text !== undefined && node.children.length === 0) {
    return `${pad}<${node.tag} ${attrs}>{${JSON.stringify(node.text)}}</${node.tag}>`;
  }

  if (node.children.length === 0) {
    return `${pad}<${node.tag} ${attrs}></${node.tag}>`;
  }

  const inner = [
    ...(node.text !== undefined
      ? [`${"  ".repeat(indent + 1)}{${JSON.stringify(node.text)}}`]
      : []),
    ...node.children.map((child) => renderJsxNode(child, indent + 1)),
  ].join("\n");

  return `${pad}<${node.tag} ${attrs}>\n${inner}\n${pad}</${node.tag}>`;
}

export function exportDocumentToReact(
  doc: UiDocument,
  options: ExportCodeOptions = {},
): string {
  const root = buildRoot(doc, options);
  const component = `${pascalCase(doc.name)}Mockup`;
  return `// Generated by AI Mockup Studio — ${doc.name}
// Inline styles only, no external dependencies.
export default function ${component}() {
  return (
${renderJsxNode(root, 2)}
  );
}
`;
}

// --- Vue --------------------------------------------------------------------

function styleAttrVue(style: Record<string, string>): string {
  return escapeHtml(htmlStyle(style));
}

function renderVueNode(node: CodeNode, indent: number): string {
  const pad = "  ".repeat(indent);
  const attrs = [
    htmlStyle(node.style) ? `style="${styleAttrVue(node.style)}"` : "",
    ...Object.entries(node.attrs)
      .filter(([, value]) => value !== "")
      .map(([key, value]) =>
        value === "true" ? key : `${key}="${escapeHtml(value)}"`,
      ),
  ]
    .filter(Boolean)
    .join(" ");
  const open = attrs ? `<${node.tag} ${attrs}` : `<${node.tag}`;

  if (VOID_TAGS.has(node.tag)) return `${pad}${open} />`;

  if (node.text !== undefined && node.children.length === 0) {
    return `${pad}${open}>${escapeVueText(node.text)}</${node.tag}>`;
  }

  if (node.children.length === 0) return `${pad}${open}></${node.tag}>`;

  const inner = [
    ...(node.text !== undefined
      ? [`${"  ".repeat(indent + 1)}${escapeVueText(node.text)}`]
      : []),
    ...node.children.map((child) => renderVueNode(child, indent + 1)),
  ].join("\n");

  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`;
}

export function exportDocumentToVue(
  doc: UiDocument,
  options: ExportCodeOptions = {},
): string {
  const root = buildRoot(doc, options);
  return `<!-- Generated by AI Mockup Studio — ${escapeHtml(doc.name)} -->
<script setup lang="ts"></script>

<template>
${renderVueNode(root, 1)}
</template>
`;
}

// --- Dispatcher -------------------------------------------------------------

export function exportDocumentToCode(
  doc: UiDocument,
  target: CodeTarget,
  options: ExportCodeOptions = {},
): string {
  switch (target) {
    case "html":
      return exportDocumentToHtml(doc, options);
    case "react":
      return exportDocumentToReact(doc, options);
    case "vue":
      return exportDocumentToVue(doc, options);
  }
}

export function codeFileExtension(target: CodeTarget): string {
  return target === "html" ? "html" : target === "react" ? "jsx" : "vue";
}
