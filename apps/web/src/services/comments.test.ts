import { describe, expect, it } from "vitest";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { commentAnchorLabel, commentSnippet } from "./comments";

describe("commentAnchorLabel", () => {
  it("prefers a button label over the registry name", () => {
    const node: UiNode = {
      id: "btn",
      type: "basic.button",
      props: { label: "Lưu thay đổi" },
    };
    expect(commentAnchorLabel(node)).toBe("Lưu thay đổi");
  });

  it("collapses whitespace and truncates long text anchors", () => {
    const node: UiNode = {
      id: "text",
      type: "basic.text",
      props: { text: `  ${"Nội dung rất dài ".repeat(6)}  ` },
    };
    const label = commentAnchorLabel(node);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label).not.toContain("  ");
  });

  it("falls back to the component definition label", () => {
    const node: UiNode = { id: "stats", type: "dashboard.stats", props: {} };
    expect(commentAnchorLabel(node)).toBe("Stats");
  });

  it("uses a page-level anchor when nothing is selected", () => {
    expect(commentAnchorLabel(null)).toBe("Toàn trang");
  });
});

describe("commentSnippet", () => {
  it("normalizes whitespace and keeps short comments intact", () => {
    expect(commentSnippet("  Đổi   màu nút\nnày ")).toBe("Đổi màu nút này");
  });

  it("truncates long comments with an ellipsis", () => {
    const snippet = commentSnippet("a".repeat(120), 20);
    expect(snippet).toBe(`${"a".repeat(19)}…`);
  });
});
