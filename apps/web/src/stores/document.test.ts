import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { walkTree, type UiDocument } from "@ai-mockup-studio/ui-schema";
import { topMostIds, useDocumentStore } from "./document";
import { cloneWithNewIds } from "../modules/canvas/clone-nodes";

function makeDocument(): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "test-doc",
    pageId: "test-page",
    name: "Test",
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
            { id: "card", type: "formal.card", children: [] },
            { id: "text", type: "basic.text", props: { text: "Hello" } },
          ],
        },
        { id: "button", type: "basic.button", props: { label: "Save" } },
        { id: "panel", type: "layout.section", children: [] },
      ],
    },
  };
}

describe("topMostIds", () => {
  it("drops descendants and the root, keeping top-most nodes only", () => {
    const root = makeDocument().root;
    expect(topMostIds(root, ["section", "card", "root", "button"])).toEqual([
      "section",
      "button",
    ]);
  });
});

describe("document store selection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps selectedId and selectedIds in sync through additive clicks", () => {
    const store = useDocumentStore();
    store.setDocument(makeDocument());

    store.selectNode("card");
    expect(store.selectedIds).toEqual(["card"]);
    expect(store.selectedId).toBe("card");

    store.selectNode("button", { additive: true });
    expect(store.selectedIds).toEqual(["card", "button"]);
    expect(store.selectedId).toBe("button");

    // Deselecting the primary falls back to the remaining node instead of
    // leaving a phantom primary id behind.
    store.selectNode("button", { additive: true });
    expect(store.selectedIds).toEqual(["card"]);
    expect(store.selectedId).toBe("card");

    // Deselecting a non-primary keeps the anchor.
    store.selectNode("section", { additive: true });
    store.selectNode("section", { additive: true });
    expect(store.selectedIds).toEqual(["card"]);
    expect(store.selectedId).toBe("card");
  });

  it("synchronises direct selectedId assignments with the selection set", () => {
    const store = useDocumentStore();
    store.setDocument(makeDocument());

    store.selectedId = "button";
    expect(store.selectedIds).toEqual(["button"]);
    expect(store.selectedId).toBe("button");

    store.selectedId = null;
    expect(store.selectedIds).toEqual([]);
    expect(store.selectedId).toBeNull();
  });

  it("removes only top-most selected nodes and prunes the selection", () => {
    const store = useDocumentStore();
    store.setDocument(makeDocument());
    store.setSelection(["section", "card"], "section");

    store.removeNodes(["section", "card"]);

    expect(store.document?.root.children?.map((node) => node.id)).toEqual([
      "button",
      "panel",
    ]);
    expect(store.selectedIds).toEqual([]);
    expect(store.selectedId).toBeNull();
  });

  it("skips locked layers when deleting", () => {
    const store = useDocumentStore();
    const document = makeDocument();
    document.root.children![1]!.locked = true;
    store.setDocument(document);
    store.setSelection(["section", "button"], "section");

    store.removeNodes(["section", "button"]);

    expect(store.document?.root.children?.map((node) => node.id)).toEqual([
      "button",
      "panel",
    ]);
    expect(store.selectedIds).toEqual(["button"]);
  });

  it("moves several selected nodes into a container in one command", () => {
    const store = useDocumentStore();
    store.setDocument(makeDocument());
    store.setSelection(["card", "button"], "card");

    store.moveNodes(["card", "button"], "panel");

    const panel = store.document?.root.children?.find(
      (node) => node.id === "panel",
    );
    expect(panel?.children?.map((node) => node.id)).toEqual(["card", "button"]);
    expect(store.selectedIds).toEqual(["card", "button"]);
  });

  it("refuses to move locked nodes or create a cycle", () => {
    const store = useDocumentStore();
    const document = makeDocument();
    document.root.children![1]!.locked = true;
    store.setDocument(document);

    // Moving a container into its own descendant is a no-op.
    const beforeCycle = store.document;
    store.moveNodes(["section"], "card");
    expect(store.document).toBe(beforeCycle);

    store.moveNodes(["card", "button"], "panel");
    const panel = store.document?.root.children?.find(
      (node) => node.id === "panel",
    );
    expect(panel?.children?.map((node) => node.id)).toEqual(["card"]);
    expect(
      store.document?.root.children?.some((node) => node.id === "button"),
    ).toBe(true);
  });

  it("drops selection ids removed by undo/redo or AI patches", () => {
    const store = useDocumentStore();
    store.setDocument(makeDocument());
    store.setSelection(["button"], "button");

    store.applyPatches(
      [{ op: "remove", targetId: "button" }],
      "Xóa button",
    );
    expect(store.selectedIds).toEqual([]);
    expect(store.selectedId).toBeNull();

    store.undo();
    expect(store.document?.root.children?.map((node) => node.id)).toContain(
      "button",
    );
  });

  it("copies nested selections top-most only, so paste clones each node once", () => {
    // Mirrors Canvas' Ctrl+C pipeline: topMostIds(selectedIds) → clipboard →
    // cloneWithNewIds → add patches. Copying "section" AND its child "card"
    // must put only the container on the clipboard — its clone already
    // carries the card, so keeping both duplicated the child on paste.
    const store = useDocumentStore();
    store.setDocument(makeDocument());
    store.setSelection(["section", "card", "button"], "section");

    const root = store.document!.root;
    const top = topMostIds(root, [...store.selectedIds]);
    expect(top).toEqual(["section", "button"]);
    const clipboard = store.selectedNodes.filter((node) =>
      top.includes(node.id),
    );
    expect(clipboard.map((node) => node.id)).toEqual(["section", "button"]);

    const clones = cloneWithNewIds(clipboard);
    store.applyPatches(
      clones.map((node) => ({ op: "add" as const, parentId: "root", node })),
      "Dán 2 component",
    );

    const counts = new Map<string, number>();
    walkTree(store.document!.root, (node) => {
      counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    });
    // Exactly one extra card (inside the section clone) and one extra button.
    expect(counts.get("formal.card")).toBe(2);
    expect(counts.get("basic.button")).toBe(2);
    expect(counts.get("basic.text")).toBe(2);
  });

  it("captureContext/isContextCurrent detect navigation during async work", () => {
    const store = useDocumentStore();
    store.setProject("p1");
    store.currentPageId = "page-1";
    const ctx = store.captureContext();
    expect(store.isContextCurrent(ctx)).toBe(true);

    // Same project, other page → stale.
    store.currentPageId = "page-2";
    expect(store.isContextCurrent(ctx)).toBe(false);

    // Same page id in another project → still stale (ids are not unique).
    store.currentPageId = "page-1";
    store.setProject("p2");
    expect(store.isContextCurrent(ctx)).toBe(false);
  });
});
