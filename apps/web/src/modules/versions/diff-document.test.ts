import { describe, expect, it } from "vitest";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { diffDocuments } from "./diff-document";

function makeDocument(): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "doc",
    pageId: "page",
    name: "Diff",
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#ffffff",
      background: "#ffffff",
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
      children: [
        {
          id: "section",
          type: "layout.section",
          children: [
            { id: "text", type: "basic.text", props: { text: "Hello" } },
            { id: "card", type: "formal.card", children: [] },
          ],
        },
      ],
    },
  };
}

describe("diffDocuments", () => {
  it("reports added, removed and changed nodes", () => {
    const before = makeDocument();
    const after = makeDocument();
    after.root.children![0]!.children = [
      { id: "text", type: "basic.text", props: { text: "Hello world" } },
      { id: "image", type: "basic.image", props: { src: "a.png" } },
    ];

    const diff = diffDocuments(before, after);

    expect(diff.added.map((node) => node.id)).toEqual(["image"]);
    expect(diff.removed.map((node) => node.id)).toEqual(["card"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.id).toBe("text");
    expect(diff.changed[0]?.fields).toContain("props");
    expect(diff.themeChanged).toBe(false);
    expect(diff.hasChanges).toBe(true);
  });

  it("is not confused by JSONB key order", () => {
    const before = makeDocument();
    const after = makeDocument();
    after.root.children![0]!.children![0]!.props = { text: "Hello" };
    // Same values, different insertion order.
    after.root.children![0]!.children![0]!.styles = { color: "#111", padding: 4 };
    before.root.children![0]!.children![0]!.styles = { padding: 4, color: "#111" };

    const diff = diffDocuments(before, after);
    expect(diff.changed).toHaveLength(0);
    expect(diff.hasChanges).toBe(false);
  });

  it("detects theme token changes", () => {
    const before = makeDocument();
    const after = makeDocument();
    after.theme = { ...after.theme, primary: "#16A34A" };

    const diff = diffDocuments(before, after);
    expect(diff.themeChanged).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });
});
