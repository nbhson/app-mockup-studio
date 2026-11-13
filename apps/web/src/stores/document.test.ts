import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { topMostIds, useDocumentStore } from "./document";

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
});
