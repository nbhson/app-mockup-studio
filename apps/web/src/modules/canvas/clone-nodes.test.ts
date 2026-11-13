import { describe, expect, it } from "vitest";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { cloneWithNewIds } from "./clone-nodes";

describe("cloneWithNewIds", () => {
  it("regenerates every id while preserving props, styles and tree shape", () => {
    const source: UiNode = {
      id: "section-1",
      type: "layout.section",
      name: "Section",
      styles: { padding: 12, backgroundColor: "#fff" },
      children: [
        {
          id: "text-1",
          type: "basic.text",
          props: { text: "Hello" },
          styles: { color: "#111" },
        },
      ],
    };

    const [copy] = cloneWithNewIds([source]);

    expect(copy.id).not.toBe(source.id);
    expect(copy.id.startsWith("section-")).toBe(true);
    expect(copy.children?.[0]?.id).not.toBe("text-1");
    expect(copy.children?.[0]?.props).toEqual({ text: "Hello" });
    expect(copy.children?.[0]?.styles).toEqual({ color: "#111" });

    // Mutating the clone must not touch the source subtree.
    copy.children![0]!.props!.text = "Changed";
    expect(source.children?.[0]?.props?.text).toBe("Hello");
  });
});
