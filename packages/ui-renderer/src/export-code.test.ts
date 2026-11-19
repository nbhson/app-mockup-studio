import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type UiDocument } from "@ai-mockup-studio/ui-schema";
import {
  exportDocumentToCode,
  exportDocumentToHtml,
  exportDocumentToReact,
  exportDocumentToVue,
  exportDesignToCode,
} from "./index";

function makeDoc(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-1",
    pageId: "page-1",
    name: "CRM Dashboard",
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#fff",
      background: "#fff",
      foreground: "#0F172A",
      muted: "#F1F5F9",
      mutedForeground: "#64748B",
      border: "#E2E8F0",
      fontFamily: "Inter",
      radius: 8,
    },
    root: {
      id: "root",
      type: "layout.container",
      children: [
        { id: "sb", type: "layout.sidebar", props: { title: "Menu" } },
        {
          id: "btn",
          type: "basic.button",
          props: { label: "Save changes" },
        },
        {
          id: "txt",
          type: "basic.text",
          props: { text: "<script>alert(1)</script> {{ unsafe }}" },
        },
        {
          id: "img",
          type: "basic.image",
          props: { src: "/api/projects/p/assets/a/raw", alt: "Logo" },
        },
      ],
    },
    ...overrides,
  };
}

describe("code export", () => {
  it("omits hidden layers from generated code", () => {
    const doc = makeDoc();
    doc.root.children![1]!.hidden = true;
    const html = exportDocumentToHtml(doc);
    expect(html).not.toContain("Save changes");
  });

  it("exports valid standalone HTML with inline styles", () => {
    const html = exportDocumentToHtml(makeDoc());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>CRM Dashboard</title>");
    expect(html).toContain("display:flex");
    expect(html).toContain(">Save changes</button>");
    expect(html).toContain('alt="Logo"');
    expect(html).toContain("object-fit:cover");
  });

  it("escapes user content and never emits executable markup", () => {
    const html = exportDocumentToHtml(makeDoc());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("inlines assets from the provided map", () => {
    const html = exportDocumentToHtml(makeDoc(), {
      assetMap: { "/api/projects/p/assets/a/raw": "data:image/png;base64,AAA" },
    });
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).not.toContain("/api/projects/p/assets/a/raw");
  });

  it("exports a React component with inline style objects", () => {
    const code = exportDocumentToReact(makeDoc());
    expect(code).toContain("export default function CRMDashboardMockup()");
    expect(code).toContain('style={{ padding: "16px", display: "flex"');
    expect(code).toContain('{"<script>alert(1)</script> {{ unsafe }}"}');
  });

  it("exports a Vue SFC whose text cannot become interpolation", () => {
    const code = exportDocumentToVue(makeDoc());
    expect(code).toContain("<template>");
    expect(code).not.toContain("{{ unsafe }}");
    expect(code).toContain("&#123;&#123; unsafe &#125;&#125;");
  });

  it("dispatches by target and returns the right extension", () => {
    expect(exportDocumentToCode(makeDoc(), "html")).toContain("<!doctype html>");
    expect(exportDocumentToCode(makeDoc(), "react")).toContain("export default function");
    expect(exportDocumentToCode(makeDoc(), "vue")).toContain("<template>");
  });
});

describe("export hardening (deep-check remediation)", () => {
  it("neutralizes code injection through the document name in the React header", () => {
    const doc = makeDoc({ name: "Bad\nconsole.log('INJECTED') //x" });
    const code = exportDocumentToReact(doc);
    const lines = code.split("\n");
    // The header comment must stay ONE line: the payload cannot become live
    // top-level code again.
    expect(lines[0]).toContain("console.log('INJECTED')");
    expect(lines[1]).toBe("// Inline styles only, no external dependencies.");
    expect(code).not.toMatch(/^\s*console\.log/m);
  });

  it("keeps boolean attributes distinguishable from string 'true' values (Vue)", () => {
    const doc = makeDoc();
    doc.root.children = [
      { id: "btn", type: "basic.button", props: { label: "OK", disabled: true } },
      { id: "in", type: "basic.input", props: { placeholder: "true" } },
    ];
    const vue = exportDocumentToVue(doc);
    expect(vue).toMatch(/<button[^>]*\bdisabled>/);
    // A literal string "true" placeholder must keep its value, not degrade
    // into a bare attribute.
    expect(vue).toContain('placeholder="true"');
    const react = exportDocumentToReact(doc);
    expect(react).toContain("disabled");
    expect(react).toContain('placeholder={"true"}');
  });

  it("sanitizes CSS-metacharacter breakouts in generated stylesheets", () => {
    const doc = makeDoc({
      name: "Evil",
      theme: {
        ...makeDoc().theme,
        fontFamily: "Inter; } * { background: url('https://evil.example/track'); @import 'x'",
      },
    });
    const bundle = exportDesignToCode(doc, "html");
    const css = bundle.files.map((f) => f.content).join("\n");
    // The token value must not be able to open new rules or load externals.
    expect(css).not.toContain("evil.example");
    expect(css).not.toContain("@import");
    const familyLine = css.split("\n").find((l) => l.includes("--font-family"));
    expect(familyLine).toBeDefined();
    // Exactly one semicolon: the declaration's own terminator — the value
    // cannot inject extra declarations or rules.
    expect(familyLine!.split(";")).toHaveLength(2);
    expect(familyLine).not.toMatch(/[{}]/);
  });
});
