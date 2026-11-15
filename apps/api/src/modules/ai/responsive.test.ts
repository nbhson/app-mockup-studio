import { describe, expect, it } from "vitest";
import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";
import {
  applyResponsiveSuggestions,
  heuristicResponsiveOptimization,
  sanitizeResponsiveStyles,
} from "./responsive";

function makeDoc(children: UiNode[]): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "responsive-doc",
    pageId: "responsive-page",
    name: "Responsive",
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
    root: { id: "root", type: "layout.container", children },
  };
}

describe("heuristicResponsiveOptimization", () => {
  it("stacks horizontal rows on mobile but leaves tablet alone", () => {
    const doc = makeDoc([
      {
        id: "row",
        type: "layout.container",
        styles: { display: "flex", flexDirection: "row" },
        children: [],
      },
    ]);

    const result = heuristicResponsiveOptimization(doc);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      nodeId: "row",
      breakpoint: "mobile",
      styles: { flexDirection: "column" },
    });
  });

  it("does not stack a navbar row", () => {
    const doc = makeDoc([
      {
        id: "nav",
        type: "layout.navbar",
        styles: { display: "flex", flexDirection: "row" },
        children: [],
      },
    ]);

    expect(heuristicResponsiveOptimization(doc).suggestions).toEqual([]);
  });

  it("shrinks fixed widths that exceed each breakpoint", () => {
    const doc = makeDoc([
      {
        id: "hero",
        type: "basic.text",
        props: { text: "Hero" },
        styles: { width: 900 },
      },
    ]);

    const result = heuristicResponsiveOptimization(doc);
    const tablet = result.suggestions.find((s) => s.breakpoint === "tablet");
    const mobile = result.suggestions.find((s) => s.breakpoint === "mobile");
    expect(tablet?.styles).toMatchObject({ width: "100%", minWidth: 0 });
    expect(mobile?.styles).toMatchObject({ width: "100%", minWidth: 0 });
  });

  it("adds auto height when shrinking a fixed-width image", () => {
    const doc = makeDoc([
      {
        id: "img",
        type: "basic.image",
        props: { src: "x.png", alt: "x" },
        styles: { width: 800, height: 400 },
      },
    ]);

    const mobile = heuristicResponsiveOptimization(doc).suggestions.find(
      (s) => s.breakpoint === "mobile",
    );
    expect(mobile?.styles).toMatchObject({ width: "100%", height: "auto" });
  });

  it("clamps oversized padding, gap and font size on mobile", () => {
    const doc = makeDoc([
      {
        id: "card",
        type: "formal.card",
        props: { title: "Card" },
        styles: { padding: 32, gap: 24, fontSize: 32 },
        children: [],
      },
    ]);

    const mobile = heuristicResponsiveOptimization(doc).suggestions.find(
      (s) => s.breakpoint === "mobile",
    );
    expect(mobile?.styles).toMatchObject({ padding: 16, gap: 12, fontSize: 24 });
  });

  it("does not propose properties already overridden for the breakpoint", () => {
    const node: UiNode = {
      id: "row",
      type: "layout.container",
      styles: { display: "flex", flexDirection: "row", padding: 24 },
      children: [],
    };
    node.responsive = {
      mobile: { flexDirection: "column", padding: 16 },
    };
    const doc = makeDoc([node]);

    expect(heuristicResponsiveOptimization(doc).suggestions).toEqual([]);
  });

  it("returns a clean summary when the layout is already responsive", () => {
    const doc = makeDoc([
      {
        id: "col",
        type: "layout.container",
        styles: { display: "flex", flexDirection: "column", padding: 16 },
        children: [],
      },
    ]);

    const result = heuristicResponsiveOptimization(doc);
    expect(result.suggestions).toEqual([]);
    expect(result.summary).toContain("Không phát hiện");
  });
});

describe("applyResponsiveSuggestions", () => {
  it("writes breakpoint overrides without touching base styles", () => {
    const doc = makeDoc([
      {
        id: "row",
        type: "layout.container",
        styles: { display: "flex", flexDirection: "row", padding: 24 },
        children: [],
      },
    ]);
    const result = heuristicResponsiveOptimization(doc);
    const fixed = applyResponsiveSuggestions(doc, result.suggestions);

    const node = fixed!.root.children![0];
    expect(node.styles).toMatchObject({ flexDirection: "row", padding: 24 });
    expect(node.responsive?.mobile).toMatchObject({
      flexDirection: "column",
      padding: 16,
    });
    // Source document stays immutable for undo/redo.
    expect(doc.root.children![0].responsive).toBeUndefined();
  });

  it("returns null when there is nothing to apply", () => {
    expect(applyResponsiveSuggestions(makeDoc([]), [])).toBeNull();
  });
});

describe("sanitizeResponsiveStyles", () => {
  it("keeps valid UiStyles keys and drops unknown/malformed values", () => {
    const clean = sanitizeResponsiveStyles({
      width: "100%",
      padding: 12,
      flexDirection: "column",
      flexWrap: "wrap",
      opacity: 0.5,
      gridTemplateColumns: "1fr 1fr",
      position: "absolute",
      flexDirectionInvalid: "sideways",
    });

    expect(clean).toEqual({
      width: "100%",
      padding: 12,
      flexDirection: "column",
      flexWrap: "wrap",
      opacity: 0.5,
    });
  });

  it("rejects invalid enum values", () => {
    expect(
      sanitizeResponsiveStyles({ flexDirection: "sideways", flexWrap: "reverse" }),
    ).toBeNull();
  });
});
