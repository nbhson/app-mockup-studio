import { describe, expect, it } from "vitest";
import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";
import { heuristicCritique } from "./critique";

function makeDoc(children: UiNode[]): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "critique-doc",
    pageId: "critique-page",
    name: "Critique",
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
      children,
    },
  };
}

describe("heuristicCritique", () => {
  it("returns a valid score and concrete findings for a rough document", () => {
    const doc = makeDoc([
      {
        id: "title",
        type: "basic.text",
        props: { text: "Low contrast" },
        styles: { color: "#888888", padding: 10 },
      },
    ]);
    doc.root.styles = { backgroundColor: "#777777", padding: 24 };

    const result = heuristicCritique(doc);
    expect(result.source).toBe("heuristic");
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThan(100);
    expect(result.findings.some((finding) => finding.category === "contrast")).toBe(true);
    expect(result.findings.some((finding) => finding.category === "spacing")).toBe(true);

    const contrast = result.findings.find((finding) => finding.category === "contrast");
    expect(contrast?.nodeId).toBe("title");
    expect(contrast?.fixStyles?.color).toBeTruthy();
  });

  it("gives a clean, well-structured document a high score", () => {
    const doc = makeDoc([
      {
        id: "header",
        type: "dashboard.header",
        props: { title: "Overview", subtitle: "Today" },
      },
      {
        id: "body",
        type: "basic.text",
        props: { text: "Everything is on scale." },
        styles: { fontSize: 16, color: "#0F172A" },
      },
    ]);
    doc.root.styles = { padding: 24 };

    const result = heuristicCritique(doc);
    expect(result.score).toBe(100);
    expect(result.findings).toEqual([]);
  });

  it("evaluates the requested breakpoint override", () => {
    const doc = makeDoc([
      {
        id: "text",
        type: "basic.text",
        props: { text: "Responsive" },
        styles: { color: "#0F172A" },
        responsive: { mobile: { color: "#FFFFFF" } },
      },
      {
        id: "header",
        type: "dashboard.header",
        props: { title: "Overview" },
      },
    ]);
    doc.root.styles = { padding: 24 };

    expect(
      heuristicCritique(doc, "desktop").findings.some(
        (finding) => finding.category === "contrast",
      ),
    ).toBe(false);
    expect(
      heuristicCritique(doc, "mobile").findings.some(
        (finding) => finding.category === "contrast",
      ),
    ).toBe(true);
  });

  it("flags missing alt text and placeholder content", () => {
    const doc = makeDoc([
      { id: "header", type: "dashboard.header", props: { title: "Overview" } },
      { id: "img", type: "basic.image", props: { src: "x.png", alt: "" } },
      {
        id: "text",
        type: "basic.text",
        props: { text: "Lorem ipsum" },
        styles: { fontSize: 16 },
      },
    ]);
    doc.root.styles = { padding: 24 };

    const result = heuristicCritique(doc);
    expect(result.findings.some((finding) => finding.category === "accessibility")).toBe(true);
    expect(result.findings.some((finding) => finding.category === "content")).toBe(true);
  });
});
