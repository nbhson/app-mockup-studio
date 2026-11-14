import { describe, expect, it } from "vitest";
import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";
import {
  analyzeConsistency,
  applyConsistencyFixes,
} from "./consistency";

function makeDoc(children: UiNode[] = []): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "consistency-doc",
    pageId: "consistency-page",
    name: "Consistency",
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

function textNode(id: string, styles: UiNode["styles"]): UiNode {
  return { id, type: "basic.text", props: { text: "Hello" }, styles };
}

describe("analyzeConsistency", () => {
  it("flags off-scale spacing and snaps to the nearest token", () => {
    const doc = makeDoc([
      textNode("a", { padding: 10 }),
      textNode("b", { gap: 13 }),
      textNode("c", { margin: 7 }),
    ]);

    const issues = analyzeConsistency(doc);
    const fixes = new Map(issues.map((issue) => [issue.property, issue.fixStyles]));

    expect(fixes.get("padding")).toEqual({ padding: 8 });
    expect(fixes.get("gap")).toEqual({ gap: 12 });
    expect(fixes.get("margin")).toEqual({ margin: 8 });
  });

  it("flags font size and radius values outside the token scales", () => {
    const doc = makeDoc([textNode("a", { fontSize: 17, borderRadius: 11 })]);

    const issues = analyzeConsistency(doc);
    expect(issues.find((issue) => issue.property === "fontSize")?.fixStyles).toEqual({
      fontSize: 16,
    });
    expect(issues.find((issue) => issue.property === "borderRadius")?.fixStyles).toEqual({
      borderRadius: 12,
    });
  });

  it("maps near-duplicate colors back to the theme token", () => {
    const doc = makeDoc([textNode("a", { color: "#2563EA" })]);

    const issue = analyzeConsistency(doc).find((item) => item.rule === "color");
    expect(issue?.fixStyles).toEqual({ color: "#2563eb" });
    expect(issue?.message).toContain("primary");
  });

  it("flags a font family that differs from the theme", () => {
    const doc = makeDoc([textNode("a", { fontFamily: "Georgia, serif" })]);

    const issue = analyzeConsistency(doc).find((item) => item.rule === "font-family");
    expect(issue?.fixStyles).toEqual({ fontFamily: "Inter, sans-serif" });
  });

  it("does not flag values already on the design system scales", () => {
    const doc = makeDoc([
      textNode("a", {
        padding: 16,
        gap: 8,
        margin: 24,
        fontSize: 14,
        borderRadius: 8,
        color: "#0F172A",
        backgroundColor: "#FFFFFF",
      }),
    ]);

    expect(analyzeConsistency(doc)).toEqual([]);
  });

  it("reports too many font sizes as an informational finding", () => {
    const sizes = [11, 13, 15, 17, 19, 21, 23];
    const doc = makeDoc(sizes.map((size, index) => textNode(`n${index}`, { fontSize: size })));

    const issues = analyzeConsistency(doc);
    expect(issues.some((issue) => issue.rule === "type-scale" && issue.severity === "info")).toBe(
      true,
    );
  });
});

describe("applyConsistencyFixes", () => {
  it("applies desktop fixes without mutating the source document", () => {
    const doc = makeDoc([textNode("a", { padding: 10, fontSize: 17 })]);
    const issues = analyzeConsistency(doc);

    const fixed = applyConsistencyFixes(doc, issues);
    expect(fixed).not.toBeNull();
    expect(fixed!.root.children![0].styles).toMatchObject({ padding: 8, fontSize: 16 });
    // Undo/redo relies on the source staying immutable.
    expect(doc.root.children![0].styles).toMatchObject({ padding: 10, fontSize: 17 });
  });

  it("writes tablet/mobile fixes as breakpoint overrides", () => {
    const node = textNode("a", { padding: 16 });
    node.responsive = { mobile: { padding: 10 } };
    const doc = makeDoc([node]);

    expect(analyzeConsistency(doc, "desktop")).toEqual([]);
    const issues = analyzeConsistency(doc, "mobile");
    expect(issues.some((issue) => issue.rule === "spacing")).toBe(true);

    const fixed = applyConsistencyFixes(doc, issues, "mobile");
    const fixedNode = fixed!.root.children![0];
    expect(fixedNode.styles?.padding).toBe(16);
    expect(fixedNode.responsive?.mobile?.padding).toBe(8);
  });
});
