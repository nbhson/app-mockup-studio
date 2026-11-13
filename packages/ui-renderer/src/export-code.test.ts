import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type UiDocument } from "@ai-mockup-studio/ui-schema";
import {
  exportDocumentToCode,
  exportDocumentToHtml,
  exportDocumentToReact,
  exportDocumentToVue,
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
