import { describe, expect, it } from "vitest";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { cloneWithNewIds } from "./clone-nodes";

describe("cloneWithNewIds", () => {
  it("regenerates every id while preserving props, styles and tree shape", () => {
    const source: UiNode = {
      id: "section-1",
      type: "layout.section",
      name: "Section",
      hidden: true,
      locked: true,
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
    expect(copy.hidden).toBeUndefined();
    expect(copy.locked).toBeUndefined();

    // Mutating the clone must not touch the source subtree.
    copy.children![0]!.props!.text = "Changed";
    expect(source.children?.[0]?.props?.text).toBe("Hello");
  });

  it("deep-clones nested props, arrays and responsive overrides", () => {
    // The old shallow clone kept every nested reference shared: editing the
    // paste's props array or a breakpoint override mutated the original.
    const source: UiNode = {
      id: "card-1",
      type: "formal.card",
      props: {
        title: "Revenue",
        items: [{ label: "Q1", value: 10 }],
        config: { gap: 4, nested: { deep: true } },
      },
      styles: { padding: 12 },
      responsive: {
        tablet: { padding: 8 },
        mobile: { padding: 4, width: 320 },
      },
      children: [
        {
          id: "chart-1",
          type: "dashboard.chart",
          props: { series: [1, 2, 3] },
          locked: true,
        },
      ],
    };

    const [copy] = cloneWithNewIds([source]);

    // Values preserved …
    expect(copy.props).toEqual(source.props);
    expect(copy.responsive).toEqual({
      tablet: { padding: 8 },
      mobile: { padding: 4, width: 320 },
    });
    // … but nothing below the top level is shared.
    expect(copy.props).not.toBe(source.props);
    expect(copy.props!.items).not.toBe(source.props!.items);
    expect(copy.props!.config).not.toBe(source.props!.config);
    expect(copy.responsive).not.toBe(source.responsive);
    expect(copy.responsive!.mobile).not.toBe(source.responsive!.mobile);
    const copyChart = copy.children![0]!;
    expect(copyChart.props!.series).not.toBe(
      source.children![0]!.props!.series,
    );
    // Deep copies of descendants are editable too (locked cleared at depth).
    expect(copyChart.locked).toBeUndefined();

    // Mutating every nested level leaves the source untouched.
    (copy.props!.items as Array<{ label: string }>)[0]!.label = "Q2";
    (copy.props!.config as { nested: { deep: boolean } }).nested.deep = false;
    copy.responsive!.mobile!.padding = 99;
    (copyChart.props!.series as number[]).push(4);
    expect(source.props!.items).toEqual([{ label: "Q1", value: 10 }]);
    expect(source.props!.config).toEqual({ gap: 4, nested: { deep: true } });
    expect(source.responsive!.mobile).toEqual({ padding: 4, width: 320 });
    expect(source.children![0]!.props!.series).toEqual([1, 2, 3]);
  });
});
