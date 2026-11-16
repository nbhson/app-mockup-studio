import { describe, expect, it } from "vitest";
import { knownComponentTypes, type UiNode } from "@ai-mockup-studio/ui-schema";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import { heuristicMultiPage } from "./multi-page";

function collectNodes(node: UiNode): UiNode[] {
  return [node, ...(node.children ?? []).flatMap(collectNodes)];
}

function collectText(node: UiNode): string[] {
  return collectNodes(node)
    .map((child) => child.props?.text)
    .filter((value): value is string => typeof value === "string");
}

describe("heuristicMultiPage", () => {
  it("generates the requested number of pages with valid, uniquely-slugged documents", () => {
    const result = heuristicMultiPage({
      prompt: "Landing page cho sản phẩm SaaS quản lý dự án",
      pageCount: 3,
    });

    expect(result.pages).toHaveLength(3);
    expect(new Set(result.pages.map((page) => page.slug)).size).toBe(3);
    expect(new Set(result.pages.map((page) => page.document.id)).size).toBe(3);
    expect(new Set(result.pages.map((page) => page.document.pageId)).size).toBe(3);

    for (const page of result.pages) {
      expect(uiDocumentSchema.safeParse(page.document).success).toBe(true);
      expect(page.document.theme).toEqual(result.theme);
      expect(page.document.name).toBe(page.name);
    }
  });

  it("clamps the page count to the supported 2–5 range", () => {
    expect(
      heuristicMultiPage({ prompt: "Dashboard", pageCount: 1 }).pages,
    ).toHaveLength(2);
    expect(
      heuristicMultiPage({ prompt: "Dashboard", pageCount: 9 }).pages,
    ).toHaveLength(5);
  });

  it("links every page through the shared navbar labels", () => {
    const result = heuristicMultiPage({
      prompt: "Landing page bán hàng cho Acme",
      pageCount: 4,
    });
    const labels = result.pages.map((page) => page.name);

    for (const page of result.pages) {
      const texts = collectText(page.document.root);
      for (const label of labels) {
        expect(texts).toContain(label);
      }
    }
  });

  it("only emits components registered in the renderer", () => {
    const result = heuristicMultiPage({
      prompt: "Dashboard quản lý dự án",
      pageCount: 5,
    });

    for (const page of result.pages) {
      for (const node of collectNodes(page.document.root)) {
        expect(knownComponentTypes).toContain(node.type);
      }
    }
  });

  it("honours the requested viewport", () => {
    const result = heuristicMultiPage({
      prompt: "Landing page cho ứng dụng di động",
      pageCount: 2,
      viewportMode: "mobile",
    });

    for (const page of result.pages) {
      expect(page.document.viewport).toEqual({ width: 390, height: 844 });
    }
  });

  it("picks an app or landing archetype from the prompt", () => {
    const app = heuristicMultiPage({
      prompt: "Dashboard quản lý dự án nội bộ",
      pageCount: 2,
    });
    const landing = heuristicMultiPage({
      prompt: "Landing page bán hàng cho Acme",
      pageCount: 2,
    });

    expect(app.pages[0]?.slug).toBe("overview");
    expect(landing.pages[0]?.slug).toBe("home");
    expect(landing.summary).toContain("2 trang");
  });
});
