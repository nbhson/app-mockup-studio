import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type UiDocument,
  type UiPatch,
} from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch, resolveDocument } from "./index";

function makeDoc(): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-1",
    pageId: "page-1",
    name: "Test",
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
        { id: "sb", type: "layout.sidebar", props: { width: 260 } },
        {
          id: "content",
          type: "layout.container",
          children: [{ id: "btn", type: "basic.button", props: { label: "Go" } }],
        },
      ],
    },
  };
}

describe("applyPatchBatch", () => {
  it("applies an update patch on props (dot path)", () => {
    const patch: UiPatch = { op: "update", targetId: "sb", changes: { "props.width": 300 } };
    const next = applyPatchBatch(makeDoc(), [patch]);
    const sb = next.root.children!.find((c) => c.id === "sb")!;
    expect(sb.props?.width).toBe(300);
  });

  it("applies a style patch", () => {
    const patch: UiPatch = { op: "style", targetId: "btn", styles: { width: 120 } };
    const next = applyPatchBatch(makeDoc(), [patch]);
    const btn = next.root.children![1].children![0];
    expect(btn.styles?.width).toBe(120);
  });

  it("applies a responsive override via dot paths without touching base styles", () => {
    const patch: UiPatch = {
      op: "update",
      targetId: "btn",
      changes: { "responsive.mobile.width": 100 },
    };
    const next = applyPatchBatch(makeDoc(), [patch]);
    const btn = next.root.children![1].children![0];
    expect(btn.responsive?.mobile?.width).toBe(100);
    expect(btn.styles?.width).toBeUndefined();
  });

  it("adds a node to a container", () => {
    const patch: UiPatch = {
      op: "add",
      parentId: "content",
      node: { id: "new-btn", type: "basic.button", props: { label: "New" } },
    };
    const next = applyPatchBatch(makeDoc(), [patch]);
    const content = next.root.children!.find((c) => c.id === "content")!;
    expect(content.children!.some((c) => c.id === "new-btn")).toBe(true);
  });

  it("removes a node", () => {
    const patch: UiPatch = { op: "remove", targetId: "sb" };
    const next = applyPatchBatch(makeDoc(), [patch]);
    expect(next.root.children!.some((c) => c.id === "sb")).toBe(false);
  });

  it("replaces a node keeping its position", () => {
    const patch: UiPatch = {
      op: "replace",
      targetId: "btn",
      node: { id: "btn", type: "basic.button", props: { label: "Replaced", variant: "secondary" } },
    };
    const next = applyPatchBatch(makeDoc(), [patch]);
    const btn = next.root.children![1].children![0];
    expect(btn.props?.label).toBe("Replaced");
  });

  it("moves a node between containers", () => {
    const patch: UiPatch = { op: "move", targetId: "btn", newParentId: "sb" };
    const next = applyPatchBatch(makeDoc(), [patch]);
    // btn now under sb
    const sb = next.root.children!.find((c) => c.id === "sb")!;
    expect(sb.children!.some((c) => c.id === "btn")).toBe(true);
    const content = next.root.children!.find((c) => c.id === "content")!;
    expect(content.children!.some((c) => c.id === "btn")).toBe(false);
  });

  it("throws on unknown target", () => {
    const patch: UiPatch = { op: "remove", targetId: "ghost" };
    expect(() => applyPatchBatch(makeDoc(), [patch])).toThrow();
  });

  it("does not mutate the original document (immutability)", () => {
    const doc = makeDoc();
    const snapshot = JSON.stringify(doc);
    applyPatchBatch(doc, [{ op: "style", targetId: "btn", styles: { width: 120 } }]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });
});

describe("resolveDocument", () => {
  it("gives layout containers an explicit flex display", () => {
    const resolved = resolveDocument(makeDoc());
    expect(resolved.styles.display).toBe("flex");
    expect(resolved.styles.flexDirection).toBe("column");
    const sidebar = resolved.children?.find((c) => c.id === "sb");
    expect(sidebar?.styles.display).toBe("flex");
    expect(sidebar?.styles.flexDirection).toBe("column");
  });

  it("resolves unknown types without crashing", () => {
    const doc = makeDoc();
    doc.root.children!.push({
      id: "mystery",
      type: "totally.unknown",
      props: {},
    });
    const resolved = resolveDocument(doc);
    // The root itself is a known container; the unknown child is flagged so
    // the canvas can render a safe placeholder without crashing.
    expect(resolved.known).toBe(true);
    expect(resolved.children?.find((c) => c.id === "mystery")?.known).toBe(false);
  });

  it("merges tablet/mobile overrides over the base styles", () => {
    const doc = makeDoc();
    const content = doc.root.children!.find((c) => c.id === "content")!;
    content.styles = { padding: 24, width: 600 };
    content.responsive = {
      tablet: { padding: 16 },
      mobile: { padding: 12, width: 320 },
    };

    const stylesOf = (root: ReturnType<typeof resolveDocument>) =>
      root.children!.find((c) => c.id === "content")!.styles;

    const desktop = stylesOf(resolveDocument(doc));
    expect(desktop.padding).toBe(24);
    expect(desktop.width).toBe(600);

    const tablet = stylesOf(resolveDocument(doc, "tablet"));
    expect(tablet.padding).toBe(16);
    expect(tablet.width).toBe(600); // not overridden → inherits desktop

    const mobile = stylesOf(resolveDocument(doc, "mobile"));
    expect(mobile.padding).toBe(12);
    expect(mobile.width).toBe(320);
  });

  it("keeps base styles untouched when resolving a breakpoint", () => {
    const doc = makeDoc();
    const content = doc.root.children!.find((c) => c.id === "content")!;
    content.styles = { width: 600 };
    content.responsive = { mobile: { width: 320 } };

    resolveDocument(doc, "mobile");
    expect(content.styles.width).toBe(600);
  });
});
