import { describe, expect, it } from "vitest";
import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";
import {
  collectDummyTargets,
  detectTopic,
  heuristicDummyData,
  sanitizeDummyProps,
} from "./dummy-data";

function makeDoc(children: UiNode[], name = "Sales dashboard"): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "dummy-doc",
    pageId: "dummy-page",
    name,
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#FFFFFF",
      background: "#FFFFFF",
      foreground: "#0F172A",
      muted: "#F1F5F9",
      mutedForeground: "#64748B",
      border: "#E2E8F0",
      fontFamily: "Inter, sans-serif",
      radius: 8,
    },
    root: { id: "root", type: "layout.container", children },
  };
}

describe("heuristicDummyData", () => {
  it("fills stats with parallel items/values arrays", () => {
    const doc = makeDoc([
      { id: "stats", type: "dashboard.stats", props: { items: ["Revenue"] } },
    ]);

    const result = heuristicDummyData(doc);
    expect(result.source).toBe("heuristic");
    expect(result.changes).toHaveLength(1);

    const props = result.changes[0].props as {
      items: string[];
      values: string[];
    };
    expect(props.items.length).toBeGreaterThanOrEqual(3);
    expect(props.values).toHaveLength(props.items.length);
    expect(props.items.join(" ")).toContain("Doanh thu");
    expect(props.values.some((value) => value.includes("₫"))).toBe(true);
  });

  it("keeps custom table headers and generates rows that match the columns", () => {
    const doc = makeDoc([
      {
        id: "table",
        type: "dashboard.table",
        props: {
          headers: ["Khách hàng", "Email", "Trạng thái"],
          rows: [["—", "—", "—"]],
        },
      },
    ]);

    const result = heuristicDummyData(doc);
    const change = result.changes[0];
    const props = change.props as {
      headers?: string[];
      rows: string[][];
    };
    // Custom headers are real copy, so they are not rewritten…
    expect(change.props.headers).toBeUndefined();
    expect(collectDummyTargets(doc)[0].props).toEqual(["rows"]);
    // …but generated rows still match their column count.
    expect(props.rows).toHaveLength(4);
    for (const row of props.rows) {
      expect(row).toHaveLength(3);
      expect(row[1]).toContain("@");
    }
  });

  it("replaces generic table headers with topic-specific ones", () => {
    const doc = makeDoc(
      [
        {
          id: "table",
          type: "dashboard.table",
          props: { headers: ["Name", "Value"], rows: [["—", "—"]] },
        },
      ],
      "Customer accounts",
    );

    const result = heuristicDummyData(doc);
    const props = result.changes[0].props as { headers: string[] };
    expect(props.headers).toContain("Email");
    expect(props.headers).not.toEqual(["Name", "Value"]);
  });

  it("preserves real copy but fills generic placeholders", () => {
    const doc = makeDoc([
      {
        id: "title",
        type: "basic.text",
        props: { text: "Doanh thu quý này đã vượt kế hoạch 8%." },
      },
      {
        id: "placeholder",
        type: "basic.text",
        props: { text: "Text content" },
      },
      {
        id: "button",
        type: "basic.button",
        props: { label: "Button" },
      },
      {
        id: "input",
        type: "basic.input",
        props: { label: "Input", placeholder: "Type here…" },
      },
    ]);

    const result = heuristicDummyData(doc);
    const ids = result.changes.map((change) => change.nodeId);
    expect(ids).not.toContain("title");
    expect(ids).toContain("placeholder");
    expect(ids).toContain("button");
    expect(ids).toContain("input");
  });

  it("restricts generation to the requested node", () => {
    const doc = makeDoc([
      { id: "stats-a", type: "dashboard.stats", props: { items: [] } },
      { id: "stats-b", type: "dashboard.stats", props: { items: [] } },
    ]);

    const result = heuristicDummyData(doc, { nodeId: "stats-b" });
    expect(result.changes.map((change) => change.nodeId)).toEqual(["stats-b"]);
  });

  it("generates English copy when locale is en", () => {
    const doc = makeDoc([
      { id: "stats", type: "dashboard.stats", props: {} },
      { id: "header", type: "dashboard.header", props: {} },
    ]);

    const result = heuristicDummyData(doc, { locale: "en" });
    const stats = result.changes.find((change) => change.nodeId === "stats");
    const header = result.changes.find((change) => change.nodeId === "header");
    expect((stats?.props.items as string[]).join(" ")).toContain("Revenue");
    expect(header?.props.title).toBe("Sales overview");
  });

  it("returns an empty result when nothing needs filling", () => {
    const doc = makeDoc([
      {
        id: "copy",
        type: "basic.text",
        props: { text: "Nội dung đã hoàn chỉnh và không cần thay đổi." },
      },
    ]);

    const result = heuristicDummyData(doc);
    expect(result.changes).toEqual([]);
    expect(result.summary).toContain("Không tìm thấy");
  });

  it("ignores hidden nodes", () => {
    const doc = makeDoc([
      {
        id: "hidden-stats",
        type: "dashboard.stats",
        hidden: true,
        props: {},
      },
    ]);

    expect(collectDummyTargets(doc)).toEqual([]);
  });
});

describe("sanitizeDummyProps", () => {
  it("drops unknown keys and malformed values", () => {
    const clean = sanitizeDummyProps("dashboard.stats", {
      items: ["Doanh thu", "Đơn hàng"],
      values: ["₫120.000.000", 42],
      styles: { color: "red" },
      dangerous: "<script>",
    });

    expect(clean).toEqual({
      items: ["Doanh thu", "Đơn hàng"],
      values: ["₫120.000.000", "42"],
    });
  });

  it("keeps stats arrays parallel", () => {
    const clean = sanitizeDummyProps("dashboard.stats", {
      items: ["A", "B", "C"],
      values: ["1", "2"],
    }) as { items: string[]; values: string[] };

    expect(clean.items).toHaveLength(2);
    expect(clean.values).toHaveLength(2);
  });

  it("rejects table rows that do not match the header count", () => {
    const clean = sanitizeDummyProps("dashboard.table", {
      headers: ["Name", "Email"],
      rows: [
        ["An", "an@example.com"],
        ["Only one column"],
      ],
    }) as { rows: string[][] };

    expect(clean.rows).toHaveLength(1);
    expect(clean.rows[0]).toHaveLength(2);
  });

  it("returns null for unsupported component types", () => {
    expect(sanitizeDummyProps("layout.container", { padding: 8 })).toBeNull();
  });

  it("rejects unknown chart kinds", () => {
    const clean = sanitizeDummyProps("dashboard.chart", {
      title: "Doanh thu",
      kind: "radar",
    });
    expect(clean).toEqual({ title: "Doanh thu" });
  });

  it("drops a stats half-pair (items without values or vice versa)", () => {
    expect(sanitizeDummyProps("dashboard.stats", { items: ["A", "B"] })).toBeNull();
    expect(sanitizeDummyProps("dashboard.stats", { values: ["1"] })).toBeNull();
  });

  it("aligns headerless table rows to a common width", () => {
    const clean = sanitizeDummyProps("dashboard.table", {
      rows: [
        ["a", "b", "c"],
        ["d", "e"],
      ],
    }) as { rows?: string[][] };

    // The narrowest row defines the grid; wider rows are dropped rather
    // than silently truncated, so the table never renders ragged.
    expect(clean.rows).toEqual([["d", "e"]]);
  });

  it("drops a chart kind when the title is missing", () => {
    expect(sanitizeDummyProps("dashboard.chart", { kind: "bar" })).toBeNull();
  });
});

describe("detectTopic", () => {
  it("classifies common dashboard contexts", () => {
    expect(detectTopic("Quản lý đơn hàng")).toBe("orders");
    expect(detectTopic("Customer accounts")).toBe("customers");
    expect(detectTopic("Danh mục sản phẩm")).toBe("products");
    expect(detectTopic("Chiến dịch marketing")).toBe("marketing");
    expect(detectTopic("Báo cáo doanh thu")).toBe("sales");
    expect(detectTopic("Trang chủ")).toBe("generic");
  });
});
