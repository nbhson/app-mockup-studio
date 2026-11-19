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

// ---------------------------------------------------------------------------
// Deep-check remediation (2026-11-19): guards that close the prototype
// pollution, subtree-loss and export-injection holes.
// ---------------------------------------------------------------------------

describe("patch security guards", () => {
  it("rejects __proto__/constructor/prototype change keys (prototype pollution)", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [
        { op: "update", targetId: "root", changes: { "__proto__.polluted": "yes" } },
      ]),
    ).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() =>
      applyPatchBatch(doc, [
        { op: "update", targetId: "root", changes: { "props.constructor.bad": 1 } },
      ]),
    ).toThrow();
  });

  it("rejects structural change keys (id/type/children)", () => {
    const doc = makeDoc();
    for (const key of ["children", "id", "type"]) {
      expect(() =>
        applyPatchBatch(doc, [{ op: "update", targetId: "btn", changes: { [key]: "oops" } }]),
      ).toThrow();
    }
  });

  it("throws when update/style targets a missing node instead of silently no-op", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [{ op: "update", targetId: "ghost", changes: { "props.x": 1 } }]),
    ).toThrow(/not found/);
    expect(() =>
      applyPatchBatch(doc, [{ op: "style", targetId: "ghost", styles: { width: 1 } }]),
    ).toThrow(/not found/);
  });

  it("rejects move into itself or into its own subtree (silent data loss)", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [{ op: "move", targetId: "content", newParentId: "content" }]),
    ).toThrow(/itself/);
    // btn is inside content — moving content under btn would detach both.
    expect(() =>
      applyPatchBatch(doc, [{ op: "move", targetId: "content", newParentId: "btn" }]),
    ).toThrow(/subtree/);
    const after = applyPatchBatch(doc, []);
    expect(after.root.children!.length).toBe(2);
  });

  it("rejects negative index on add/move", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [
        { op: "add", parentId: "content", index: -1, node: { id: "x1", type: "typography.text" } },
      ]),
    ).toThrow(/index/);
    expect(() =>
      applyPatchBatch(doc, [
        { op: "move", targetId: "sb", newParentId: "content", index: -2 },
      ]),
    ).toThrow(/index/);
  });

  it("rejects add/replace that would create duplicate node ids", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [
        { op: "add", parentId: "content", node: { id: "btn", type: "basic.button" } },
      ]),
    ).toThrow(/unique|exists/);
    expect(() =>
      applyPatchBatch(doc, [
        { op: "replace", targetId: "btn", node: { id: "dup", type: "basic.button", children: [{ id: "sb", type: "layout.sidebar" }] } },
      ]),
    ).toThrow(/exists/);
  });

  it("rejects adding a child into a non-container parent", () => {
    const doc = makeDoc();
    expect(() =>
      applyPatchBatch(doc, [
        { op: "add", parentId: "btn", node: { id: "kid", type: "typography.text" } },
      ]),
    ).toThrow(/not a container/);
  });

  it("renders no children for non-container types (matches the exporters)", () => {
    const doc = makeDoc();
    doc.root.children![1].children = [
      { id: "btn", type: "basic.button", children: [{ id: "kid", type: "typography.text" }] },
    ];
    const resolved = resolveDocument(doc);
    const btn = resolved.children!.find((c) => c.id === "content")!.children!.find((c) => c.id === "btn")!;
    expect(btn.children).toBeUndefined();
  });
});
