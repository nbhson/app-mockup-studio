import { describe, expect, it } from "vitest";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import {
  analyzeAccessibility,
  applyAccessibilityFixes,
} from "./accessibility";

function makeDoc(): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "a11y-doc",
    pageId: "a11y-page",
    name: "A11y",
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#FFFFFF",
      background: "#FFFFFF",
      foreground: "#0F172A",
      muted: "#F1F5F9",
      mutedForeground: "#64748B",
      border: "#E2E8F0",
      fontFamily: "Inter, sans-serif",
      radius: 8,
    },
    root: {
      id: "root",
      type: "layout.container",
      children: [],
    },
  };
}

describe("analyzeAccessibility", () => {
  it("flags low text/background contrast and proposes a readable color", () => {
    const doc = makeDoc();
    doc.root.styles = { backgroundColor: "#777777" };
    doc.root.children = [
      {
        id: "low-text",
        type: "basic.text",
        props: { text: "Low contrast" },
        styles: { color: "#888888" },
      },
    ];

    const issues = analyzeAccessibility(doc);
    const contrast = issues.find((issue) => issue.rule === "contrast");
    expect(contrast?.nodeId).toBe("low-text");
    expect(contrast?.severity).toBe("error");
    expect(contrast?.fixStyles?.color).toBeTruthy();
  });

  it("does not flag high-contrast text", () => {
    const doc = makeDoc();
    doc.root.children = [
      {
        id: "good-text",
        type: "basic.text",
        props: { text: "Readable" },
        styles: { color: "#0F172A" },
      },
    ];
    expect(analyzeAccessibility(doc).some((i) => i.rule === "contrast")).toBe(false);
  });

  it("checks alt text, labels, font size and tap targets", () => {
    const doc = makeDoc();
    doc.root.children = [
      { id: "img", type: "basic.image", props: { alt: "   " } },
      {
        id: "btn",
        type: "basic.button",
        props: { label: "  ", variant: "primary" },
        styles: { width: 20, height: 24, fontSize: 10 },
      },
      {
        id: "input",
        type: "basic.input",
        props: { label: "", placeholder: "" },
      },
      {
        id: "small",
        type: "basic.text",
        props: { text: "Fine print" },
        styles: { fontSize: 10 },
      },
    ];

    const rules = analyzeAccessibility(doc).map((issue) => issue.rule);
    expect(rules).toContain("missing-alt");
    expect(rules.filter((rule) => rule === "missing-label")).toHaveLength(2);
    expect(rules).toContain("small-text");
    expect(rules).toContain("small-target");
  });

  it("uses the active breakpoint overrides", () => {
    const doc = makeDoc();
    doc.root.children = [
      {
        id: "text",
        type: "basic.text",
        props: { text: "Responsive" },
        styles: { color: "#0F172A" },
        responsive: { mobile: { color: "#F8FAFC" } },
      },
    ];

    expect(analyzeAccessibility(doc, "desktop").some((i) => i.rule === "contrast")).toBe(false);
    expect(analyzeAccessibility(doc, "mobile").some((i) => i.rule === "contrast")).toBe(true);
  });
});

describe("applyAccessibilityFixes", () => {
  it("applies safe style fixes without mutating the source document", () => {
    const doc = makeDoc();
    doc.root.styles = { backgroundColor: "#777777" };
    doc.root.children = [
      {
        id: "text",
        type: "basic.text",
        props: { text: "Low" },
        styles: { color: "#888888", fontSize: 10 },
      },
    ];

    const issues = analyzeAccessibility(doc);
    const fixed = applyAccessibilityFixes(doc, issues);
    expect(fixed).not.toBeNull();
    const node = fixed!.root.children![0];
    expect(node.styles?.color).not.toBe("#888888");
    expect(node.styles?.fontSize).toBe(14);
    // Original document is untouched (undo/redo relies on immutability).
    expect(doc.root.children![0].styles?.color).toBe("#888888");
  });

  it("returns null when only manual issues remain", () => {
    const doc = makeDoc();
    doc.root.children = [{ id: "img", type: "basic.image", props: { alt: "" } }];
    expect(applyAccessibilityFixes(doc, analyzeAccessibility(doc))).toBeNull();
  });
});
