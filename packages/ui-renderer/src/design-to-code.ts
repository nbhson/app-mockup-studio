// ---------------------------------------------------------------------------
// Design-to-code (plan/07 4.2).
//
// 4.1 exports a single file with inline styles. This generator turns the same
// resolved tree into a small, readable component project:
//   - one component per top-level structural block (header/stats/table/...),
//   - semantic CSS classes in `styles.css` instead of inline style objects,
//   - design tokens emitted as CSS custom properties,
//   - the same escaping guarantees as the 4.1 exporter.
//
// The output is a plain data bundle (files + contents), so the web dialog can
// show each file, let the user edit it, and download/copy it without a bundler.
// ---------------------------------------------------------------------------

import type { Theme, UiDocument } from "@ai-mockup-studio/ui-schema";
import {
  buildCodeRoot,
  escapeHtml,
  escapeVueText,
  kebabCase,
  pascalCase,
  safeCommentText,
  safeCssValue,
  type CodeNode,
  type ExportCodeOptions,
} from "./export-code";

export type DesignCodeTarget = "html" | "react" | "vue";

export interface DesignCodeFile {
  path: string;
  language: "html" | "jsx" | "vue" | "css";
  content: string;
}

export interface DesignCodeBundle {
  target: DesignCodeTarget;
  componentName: string;
  files: DesignCodeFile[];
  summary: string;
}

const VOID_TAGS = new Set(["img", "input", "br", "hr"]);

// --- Class names & CSS ------------------------------------------------------

function slugClass(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "node";
  return /^[a-z]/.test(slug) ? slug : `node-${slug}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COLOR_TOKENS: [keyof Theme, string][] = [
  ["primary", "--color-primary"],
  ["primaryForeground", "--color-primary-foreground"],
  ["background", "--color-background"],
  ["foreground", "--color-foreground"],
  ["muted", "--color-muted"],
  ["mutedForeground", "--color-muted-foreground"],
  ["border", "--color-border"],
];

/** Map theme colors (including inside shorthand values) to CSS variables. */
function cssValue(value: string, theme: Theme): string {
  const lower = value.trim().toLowerCase();
  if (lower === theme.fontFamily.trim().toLowerCase()) return "var(--font-family)";
  if (lower === `${theme.radius}px`) return "var(--radius)";

  for (const [key, variable] of COLOR_TOKENS) {
    const raw = String(theme[key]).trim();
    if (!raw.startsWith("#")) continue;
    if (lower === raw.toLowerCase()) return `var(${variable})`;
  }

  let result = value;
  for (const [key, variable] of COLOR_TOKENS) {
    const raw = String(theme[key]).trim();
    if (!raw.startsWith("#")) continue;
    const pattern = new RegExp(`${escapeRegExp(raw)}(?![0-9a-f])`, "gi");
    result = result.replace(pattern, `var(${variable})`);
  }
  return result;
}

function cssRule(className: string, style: Record<string, string>, theme: Theme): string {
  const declarations = Object.entries(style).map(
    ([key, value]) => `  ${kebabCase(key)}: ${safeCssValue(cssValue(value, theme))};`,
  );
  return `.${className} {\n${declarations.join("\n")}\n}`;
}

class ClassRegistry {
  private readonly bySignature = new Map<string, string>();
  private readonly usedNames = new Set<string>();
  readonly rules: string[] = [];

  constructor(private readonly theme: Theme) {}

  classFor(node: CodeNode): string | undefined {
    if (Object.keys(node.style).length === 0) return undefined;

    const base = slugClass(node.role ?? node.tag);
    const signature = `${base}|${JSON.stringify(node.style)}`;
    const existing = this.bySignature.get(signature);
    if (existing) return existing;

    let name = base;
    let index = 2;
    while (this.usedNames.has(name)) name = `${base}-${index++}`;
    this.usedNames.add(name);
    this.bySignature.set(signature, name);
    this.rules.push(cssRule(name, node.style, this.theme));
    return name;
  }
}

function assignClasses(
  node: CodeNode,
  registry: ClassRegistry,
  classes: WeakMap<CodeNode, string>,
): void {
  const className = registry.classFor(node);
  if (className) classes.set(node, className);
  for (const child of node.children) assignClasses(child, registry, classes);
}

function classAttr(node: CodeNode, classes: WeakMap<CodeNode, string>): string {
  return classes.get(node) ?? "";
}

// --- Framework renderers ----------------------------------------------------

function renderHtml(
  node: CodeNode,
  classes: WeakMap<CodeNode, string>,
  indent: number,
): string {
  const pad = "  ".repeat(indent);
  const cls = classAttr(node, classes);
  const attrs = [
    cls ? `class="${cls}"` : "",
    ...Object.entries(node.attrs)
      .filter(([, value]) => value !== "" && value !== false)
      .map(([key, value]) =>
        value === true ? key : `${key}="${escapeHtml(String(value))}"`,
      ),
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
    ...(node.text !== undefined
      ? [`${"  ".repeat(indent + 1)}${escapeHtml(node.text)}`]
      : []),
    ...node.children.map((child) => renderHtml(child, classes, indent + 1)),
  ].join("\n");
  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`;
}

function renderJsx(
  node: CodeNode,
  classes: WeakMap<CodeNode, string>,
  indent: number,
): string {
  const pad = "  ".repeat(indent);
  const cls = classAttr(node, classes);
  const attrs = [
    cls ? `className="${cls}"` : "",
    ...Object.entries(node.attrs)
      .filter(([, value]) => value !== "" && value !== false)
      .map(([key, value]) =>
        value === true ? key : `${key}={${JSON.stringify(String(value))}}`,
      ),
  ]
    .filter(Boolean)
    .join(" ");
  const open = attrs ? `<${node.tag} ${attrs}` : `<${node.tag}`;

  if (VOID_TAGS.has(node.tag)) return `${pad}${open} />`;
  if (node.text !== undefined && node.children.length === 0) {
    return `${pad}${open}>{${JSON.stringify(node.text)}}</${node.tag}>`;
  }
  if (node.children.length === 0) {
    return `${pad}${open}></${node.tag}>`;
  }

  const inner = [
    ...(node.text !== undefined
      ? [`${"  ".repeat(indent + 1)}{${JSON.stringify(node.text)}}`]
      : []),
    ...node.children.map((child) => renderJsx(child, classes, indent + 1)),
  ].join("\n");
  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`;
}

function renderVue(
  node: CodeNode,
  classes: WeakMap<CodeNode, string>,
  indent: number,
): string {
  const pad = "  ".repeat(indent);
  const cls = classAttr(node, classes);
  const attrs = [
    cls ? `class="${cls}"` : "",
    ...Object.entries(node.attrs)
      .filter(([, value]) => value !== "" && value !== false)
      .map(([key, value]) =>
        value === true ? key : `${key}="${escapeHtml(String(value))}"`,
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
    ...node.children.map((child) => renderVue(child, classes, indent + 1)),
  ].join("\n");
  return `${pad}${open}>\n${inner}\n${pad}</${node.tag}>`;
}

// --- Component splitting ----------------------------------------------------

interface Section {
  node: CodeNode;
  name: string;
}

/** Extract top-level structural blocks into standalone components. */
function collectSections(root: CodeNode): Section[] {
  const used = new Set<string>();
  const sections: Section[] = [];

  for (const child of root.children) {
    if (child.children.length === 0) continue;
    const base = pascalCase(child.role ?? child.tag) || "Section";
    let name = `${base}Section`;
    let index = 2;
    while (used.has(name)) name = `${base}Section${index++}`;
    used.add(name);
    sections.push({ node: child, name });
  }
  return sections;
}

function rootClassName(root: CodeNode, classes: WeakMap<CodeNode, string>): string {
  return ["mockup-root", classAttr(root, classes)].filter(Boolean).join(" ");
}

function themeStylesheet(doc: UiDocument): string {
  const theme = doc.theme;
  return `/* Design tokens extracted from the mockup (plan/07 4.2). */
:root {
  --color-primary: ${safeCssValue(theme.primary)};
  --color-primary-foreground: ${safeCssValue(theme.primaryForeground)};
  --color-background: ${safeCssValue(theme.background)};
  --color-foreground: ${safeCssValue(theme.foreground)};
  --color-muted: ${safeCssValue(theme.muted)};
  --color-muted-foreground: ${safeCssValue(theme.mutedForeground)};
  --color-border: ${safeCssValue(theme.border)};
  --font-family: ${safeCssValue(theme.fontFamily)};
  --radius: ${theme.radius}px;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-family), system-ui, sans-serif;
}

.mockup-root {
  min-height: 100vh;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-family), system-ui, sans-serif;
}`;
}

function buildHtmlBundle(
  doc: UiDocument,
  root: CodeNode,
  classes: WeakMap<CodeNode, string>,
  sections: Section[],
  registry: ClassRegistry,
): DesignCodeFile[] {
  const sectionByNode = new Map(sections.map((section) => [section.node, section.name]));
  const body = root.children
    .map((child) => {
      const name = sectionByNode.get(child);
      const rendered = renderHtml(child, classes, 2);
      return name ? `    <!-- ${name} -->\n${rendered}` : rendered;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(doc.name)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="${rootClassName(root, classes)}">
${body}
  </main>
</body>
</html>
`;

  return [
    { path: "index.html", language: "html", content: html },
    stylesFile(doc, registry),
  ];
}

function stylesFile(doc: UiDocument, registry: ClassRegistry): DesignCodeFile {
  return {
    path: "styles.css",
    language: "css",
    content: `/* Generated by AI Mockup Studio — ${safeCommentText(doc.name)} */
${themeStylesheet(doc)}

${registry.rules.join("\n\n")}
`,
  };
}

function buildReactBundle(
  doc: UiDocument,
  root: CodeNode,
  classes: WeakMap<CodeNode, string>,
  sections: Section[],
  registry: ClassRegistry,
  componentName: string,
): DesignCodeFile[] {
  const sectionByNode = new Map(sections.map((section) => [section.node, section.name]));
  const childLines = root.children.map((child) => {
    const sectionName = sectionByNode.get(child);
    return sectionName
      ? `      <${sectionName} />`
      : renderJsx(child, classes, 3);
  });
  if (root.text !== undefined) {
    childLines.unshift(`      {${JSON.stringify(root.text)}}`);
  }

  const imports = [
    `import "./styles.css";`,
    ...sections.map(
      (section) => `import ${section.name} from "./components/${section.name}";`,
    ),
  ].join("\n");

  const app = `// Generated by AI Mockup Studio — ${safeCommentText(doc.name)}
// Design-to-code (plan/07 4.2): components + semantic classes + CSS tokens.
${imports}

export default function ${componentName}() {
  return (
    <main className="${rootClassName(root, classes)}">
${childLines.join("\n")}
    </main>
  );
}
`;

  const components = sections.map<DesignCodeFile>((section) => ({
    path: `components/${section.name}.jsx`,
    language: "jsx",
    content: `// Generated by AI Mockup Studio — ${section.name}
export default function ${section.name}() {
  return (
${renderJsx(section.node, classes, 2)}
  );
}
`,
  }));

  return [
    { path: "App.jsx", language: "jsx", content: app },
    ...components,
    stylesFile(doc, registry),
  ];
}

function buildVueBundle(
  doc: UiDocument,
  root: CodeNode,
  classes: WeakMap<CodeNode, string>,
  sections: Section[],
  registry: ClassRegistry,
): DesignCodeFile[] {
  const sectionByNode = new Map(sections.map((section) => [section.node, section.name]));
  const childLines = root.children.map((child) => {
    const sectionName = sectionByNode.get(child);
    return sectionName
      ? `    <${sectionName} />`
      : renderVue(child, classes, 2);
  });
  if (root.text !== undefined) {
    childLines.unshift(`    ${escapeVueText(root.text)}`);
  }

  const imports = [
    `import "./styles.css";`,
    ...sections.map(
      (section) =>
        `import ${section.name} from "./components/${section.name}.vue";`,
    ),
  ].join("\n");

  const app = `<!-- Generated by AI Mockup Studio — ${escapeHtml(doc.name)} -->
<script setup lang="ts">
${imports}
</script>

<template>
  <main class="${rootClassName(root, classes)}">
${childLines.join("\n")}
  </main>
</template>
`;

  const components = sections.map<DesignCodeFile>((section) => ({
    path: `components/${section.name}.vue`,
    language: "vue",
    content: `<!-- Generated by AI Mockup Studio — ${section.name} -->
<template>
${renderVue(section.node, classes, 1)}
</template>
`,
  }));

  return [
    { path: "App.vue", language: "vue", content: app },
    ...components,
    stylesFile(doc, registry),
  ];
}

// --- Public API -------------------------------------------------------------

export function exportDesignToCode(
  doc: UiDocument,
  target: DesignCodeTarget,
  options: ExportCodeOptions = {},
): DesignCodeBundle {
  const root = buildCodeRoot(doc, options);
  const registry = new ClassRegistry(doc.theme);
  const classes = new WeakMap<CodeNode, string>();
  assignClasses(root, registry, classes);
  const sections = collectSections(root);
  const componentName = `${pascalCase(doc.name)}Page`;

  const files =
    target === "html"
      ? buildHtmlBundle(doc, root, classes, sections, registry)
      : target === "react"
        ? buildReactBundle(doc, root, classes, sections, registry, componentName)
        : buildVueBundle(doc, root, classes, sections, registry);

  const componentCount = target === "html" ? 1 : sections.length + 1;
  return {
    target,
    componentName,
    files,
    summary: `${componentCount} component · ${registry.rules.length} CSS class · design tokens as CSS variables`,
  };
}
