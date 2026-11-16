import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type UiDocument } from "@ai-mockup-studio/ui-schema";
import { exportDesignToCode } from "./index";

const theme = {
  mode: "light" as const,
  primary: "#2563EB",
  primaryForeground: "#FFFFFF",
  background: "#FFFFFF",
  foreground: "#0F172A",
  muted: "#F1F5F9",
  mutedForeground: "#64748B",
  border: "#E2E8F0",
  fontFamily: "Inter, sans-serif",
  radius: 8,
};

function makeDoc(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-d2c",
    pageId: "page-d2c",
    name: "CRM Dashboard",
    viewport: { width: 1440, height: 900 },
    theme,
    root: {
      id: "root",
      type: "layout.container",
      styles: { padding: 24, gap: 16, flexDirection: "column" },
      children: [
        {
          id: "header",
          type: "dashboard.header",
          props: { title: "Doanh thu", subtitle: "Tháng 11" },
        },
        {
          id: "stats",
          type: "dashboard.stats",
          props: {
            items: ["Đơn hàng", "Doanh thu"],
            values: ["1.240", "320 triệu"],
          },
        },
        {
          id: "nested",
          type: "layout.container",
          styles: { padding: 16, gap: 8, backgroundColor: theme.primary },
          children: [
            {
              id: "nested-text",
              type: "basic.text",
              styles: { fontSize: 18, color: theme.primaryForeground },
              props: { text: "Nội dung lồng nhau" },
            },
          ],
        },
        {
          id: "cta",
          type: "basic.button",
          props: { label: "Lưu thay đổi" },
        },
        {
          id: "unsafe",
          type: "basic.text",
          props: { text: "<script>alert(1)</script> {{ unsafe }}" },
        },
      ],
    },
    ...overrides,
  };
}

function file(bundle: ReturnType<typeof exportDesignToCode>, path: string): string {
  const found = bundle.files.find((entry) => entry.path === path);
  if (!found) throw new Error(`missing file ${path}: ${bundle.files.map((f) => f.path).join(",")}`);
  return found.content;
}

describe("design-to-code export", () => {
  it("splits top-level blocks into React components with a stylesheet", () => {
    const bundle = exportDesignToCode(makeDoc(), "react");
    expect(bundle.componentName).toBe("CRMDashboardPage");
    expect(bundle.files.map((entry) => entry.path)).toEqual([
      "App.jsx",
      "components/HeaderSection.jsx",
      "components/StatsSection.jsx",
      "components/ContainerSection.jsx",
      "styles.css",
    ]);

    const app = file(bundle, "App.jsx");
    expect(app).toContain('import "./styles.css";');
    expect(app).toContain('import HeaderSection from "./components/HeaderSection";');
    expect(app).toContain("<HeaderSection />");
    expect(app).toContain("<StatsSection />");
    expect(app).toContain("<button className=");
    expect(app).not.toContain("style={");

    const header = file(bundle, "components/HeaderSection.jsx");
    expect(header).toContain("export default function HeaderSection()");
    expect(header).toContain("Doanh thu");
    expect(header).toContain('className="header-title"');

    const nested = file(bundle, "components/ContainerSection.jsx");
    expect(nested).toContain("Nội dung lồng nhau");
    expect(nested).toContain('className="text"');
  });

  it("maps design tokens to CSS variables and dedupes identical classes", () => {
    const bundle = exportDesignToCode(makeDoc(), "react");
    const css = file(bundle, "styles.css");
    expect(css).toContain("--color-primary: #2563EB;");
    expect(css).toContain("--font-family: Inter, sans-serif;");
    expect(css).toContain("background-color: var(--color-primary);");
    expect(css).toContain("color: var(--color-primary-foreground);");
    expect(css.match(/\.text \{/g)?.length).toBe(1);
    expect(css).not.toContain("style=");
  });

  it("exports a Vue project with SFC section components", () => {
    const bundle = exportDesignToCode(makeDoc(), "vue");
    expect(bundle.files.map((entry) => entry.path)).toContain(
      "components/HeaderSection.vue",
    );
    const app = file(bundle, "App.vue");
    expect(app).toContain('<script setup lang="ts">');
    expect(app).toContain('import HeaderSection from "./components/HeaderSection.vue";');
    expect(app).toContain("<HeaderSection />");
    expect(app).toContain('<main class="mockup-root container">');

    const header = file(bundle, "components/HeaderSection.vue");
    expect(header).toContain("<template>");
    expect(header).toContain("Doanh thu");
  });

  it("exports standalone HTML with a linked stylesheet and section markers", () => {
    const bundle = exportDesignToCode(makeDoc(), "html");
    expect(bundle.files.map((entry) => entry.path)).toEqual([
      "index.html",
      "styles.css",
    ]);
    const html = file(bundle, "index.html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<link rel="stylesheet" href="styles.css" />');
    expect(html).toContain("<!-- HeaderSection -->");
    expect(html).toContain('class="mockup-root container"');
    expect(html).not.toContain('style="');
  });

  it("keeps the escaping guarantees of the inline exporter", () => {
    const html = exportDesignToCode(makeDoc(), "html");
    const htmlCode = file(html, "index.html");
    expect(htmlCode).not.toContain("<script>alert(1)</script>");
    expect(htmlCode).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    const vue = exportDesignToCode(makeDoc(), "vue");
    const vueApp = file(vue, "App.vue");
    expect(vueApp).not.toContain("{{ unsafe }}");

    const react = exportDesignToCode(makeDoc(), "react");
    const reactApp = file(react, "App.jsx");
    expect(reactApp).toContain('{"<script>alert(1)</script> {{ unsafe }}"}');
  });

  it("omits hidden layers and is deterministic", () => {
    const doc = makeDoc();
    doc.root.children![3]!.hidden = true;
    const first = exportDesignToCode(doc, "react");
    const second = exportDesignToCode(doc, "react");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(file(first, "App.jsx")).not.toContain("Lưu thay đổi");
  });

  it("summarises the generated structure", () => {
    const bundle = exportDesignToCode(makeDoc(), "react");
    expect(bundle.summary).toContain("4 component");
    expect(bundle.summary).toContain("CSS class");
  });
});
