import { describe, expect, it } from "vitest";
import {
  addPatchSchema,
  isSafeChangeKey,
  movePatchSchema,
  themeSchema,
  uiDocumentSchema,
  updatePatchSchema,
} from "./index";
import type { UiNode } from "@ai-mockup-studio/ui-schema";

const theme = {
  mode: "light" as const,
  primary: "#2563EB",
  primaryForeground: "#FFFFFF",
  background: "#FFFFFF",
  foreground: "#0F172A",
  muted: "#F1F5F9",
  mutedForeground: "#64748B",
  border: "#E2E8F0",
  fontFamily: "Inter, sans-serif",
  radius: 8,
};

function docWith(root: UiNode) {
  return {
    schemaVersion: "0.1.0",
    id: "doc-1",
    pageId: "page-1",
    name: "Test",
    viewport: { width: 1440, height: 900 },
    theme,
    root,
  };
}

/**
 * Untyped JSON, i.e. what comes straight off the wire (or out of a model)
 * before zod normalises it. `UiNode` itself forbids things like
 * `borderRadius: "12px"`, so tolerant-input tests need this looser shape.
 */
function rawDocWith(root: Record<string, unknown>) {
  return { ...docWith({ id: "seed", type: "layout.container" }), root };
}

describe("updatePatchSchema.changes keys", () => {
  it("accepts the editor's own key shapes", () => {
    for (const key of [
      "props.width",
      "styles.padding",
      "responsive.mobile.width",
      "name",
      "hidden",
      "locked",
      "text",
    ]) {
      const res = updatePatchSchema.safeParse({
        op: "update",
        targetId: "a",
        changes: { [key]: 1 },
      });
      expect(res.success, `expected ${key} to pass`).toBe(true);
    }
  });

  it("rejects prototype-accessor and structural keys", () => {
    for (const key of [
      "__proto__.polluted",
      "props.__proto__.x",
      "constructor.prototype.x",
      "children",
      "id",
      "type",
      "props.constructor.name",
    ]) {
      expect(isSafeChangeKey(key), key).toBe(false);
      const res = updatePatchSchema.safeParse({
        op: "update",
        targetId: "a",
        changes: { [key]: 1 },
      });
      expect(res.success, `expected ${key} to fail`).toBe(false);
    }
  });
});

describe("patch index bounds", () => {
  it("rejects negative index on add and move", () => {
    expect(
      addPatchSchema.safeParse({
        op: "add",
        parentId: "p",
        index: -1,
        node: { id: "n", type: "basic.text" },
      }).success,
    ).toBe(false);
    expect(
      movePatchSchema.safeParse({ op: "move", targetId: "a", newParentId: "b", index: -2 })
        .success,
    ).toBe(false);
  });

  it("rejects moving a node into itself", () => {
    expect(
      movePatchSchema.safeParse({ op: "move", targetId: "a", newParentId: "a" }).success,
    ).toBe(false);
  });
});

describe("uiDocumentSchema", () => {
  it("rejects duplicate node ids", () => {
    const dup = docWith({
      id: "root",
      type: "layout.container",
      children: [
        { id: "x", type: "basic.text" },
        { id: "x", type: "basic.text" },
      ],
    });
    const res = uiDocumentSchema.safeParse(dup);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /nhiều lần|duplicate/i.test(i.message))).toBe(true);
    }
  });

  it("accepts a well-formed document", () => {
    const ok = docWith({
      id: "root",
      type: "layout.container",
      children: [{ id: "x", type: "basic.text" }],
    });
    expect(uiDocumentSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects pathological depth with a clean validation error (no stack overflow)", () => {
    let node: UiNode = { id: "n0", type: "basic.text" };
    for (let i = 1; i <= 10_000; i += 1) node = { id: `n${i}`, type: "layout.container", children: [node] };
    // The pre-pass THROWS a ZodError before zod's own recursion can blow the
    // stack. Callers (API exception filter, web store try/catch) see a 400 /
    // readable failure instead of a RangeError crash.
    expect(() => uiDocumentSchema.parse(docWith(node))).toThrow(/5000 node/);
  });

  it("rejects a cyclic input object graph instead of looping forever", () => {
    const root: Record<string, unknown> = { id: "root", type: "layout.container", children: [] };
    (root.children as unknown[]).push(root);
    expect(() => uiDocumentSchema.parse(docWith(root as unknown as UiNode))).toThrow(/cycle/);
  });

  it("bounds the document name", () => {
    expect(uiDocumentSchema.safeParse(docWith({ id: "r", type: "basic.text" })).success).toBe(true);
    const long = docWith({ id: "r", type: "basic.text" });
    long.name = "x".repeat(500);
    expect(uiDocumentSchema.safeParse(long).success).toBe(false);
  });

  it("coerces the quoted CSS numbers a model writes", () => {
    // Real LLM answers style like CSS: `"borderRadius": "24px"`,
    // `"opacity": "0.9"`. Those are the same value the renderer uses, so the
    // schema normalises them instead of rejecting the whole document — which
    // used to burn all three AI retries and show the offline fallback.
    const res = uiDocumentSchema.safeParse(
      rawDocWith({
        id: "root",
        type: "layout.container",
        styles: { borderRadius: "24px", opacity: "0.9", flexShrink: "0", gap: "16" },
      }),
    );
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.root.styles).toMatchObject({
        borderRadius: 24,
        opacity: 0.9,
        flexShrink: 0,
        gap: "16",
      });
    }
  });

  it("still rejects sizes that are not numbers at all", () => {
    expect(
      uiDocumentSchema.safeParse(
        rawDocWith({ id: "root", type: "layout.container", styles: { borderRadius: "large" } }),
      ).success,
    ).toBe(false);
    expect(
      uiDocumentSchema.safeParse(
        rawDocWith({ id: "root", type: "layout.container", styles: { opacity: Number.NaN } }),
      ).success,
    ).toBe(false);
  });
});

describe("themeSchema", () => {
  it("only accepts CSS-safe color and font values", () => {
    expect(themeSchema.safeParse(theme).success).toBe(true);
    expect(
      themeSchema.safeParse({ ...theme, primary: "red; } * { x" }).success,
    ).toBe(false);
    expect(
      themeSchema.safeParse({ ...theme, fontFamily: "Inter; } body { display:none" }).success,
    ).toBe(false);
  });
});
