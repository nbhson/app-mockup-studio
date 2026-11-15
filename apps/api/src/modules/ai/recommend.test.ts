import { describe, expect, it } from "vitest";
import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";
import { knownComponentTypes } from "@ai-mockup-studio/ui-schema";
import { heuristicRecommendations } from "./recommend";

function makeDoc(children: UiNode[], name = "Dashboard"): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "recommend-doc",
    pageId: "recommend-page",
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

describe("heuristicRecommendations", () => {
  it("recommends a form flow when the goal is to sign up", () => {
    const doc = makeDoc([
      { id: "header", type: "dashboard.header", props: { title: "Welcome" } },
    ]);

    const result = heuristicRecommendations(doc, "Tạo form đăng ký tài khoản");

    expect(result.source).toBe("heuristic");
    const types = result.suggestions.map((suggestion) => suggestion.type);
    expect(types[0]).toBe("formal.form");
    expect(types).toContain("basic.input");
    expect(types).toContain("basic.button");
    expect(result.summary).toContain("form đăng ký");
  });

  it("suggests data components for a dashboard without them", () => {
    const doc = makeDoc([
      { id: "header", type: "dashboard.header", props: { title: "Overview" } },
    ]);

    const types = heuristicRecommendations(doc).suggestions.map((s) => s.type);
    expect(types).toContain("dashboard.stats");
    expect(types).toContain("dashboard.chart");
  });

  it("uses visible copy as context", () => {
    const doc = makeDoc([
      {
        id: "text",
        type: "basic.text",
        props: { text: "Doanh thu quý 3 tăng mạnh" },
      },
    ]);

    const types = heuristicRecommendations(doc).suggestions.map((s) => s.type);
    expect(types).toContain("dashboard.stats");
    expect(types).toContain("dashboard.chart");
  });

  it("ranks a component already in the document lower", () => {
    const doc = makeDoc([
      { id: "header", type: "dashboard.header", props: { title: "Overview" } },
      { id: "stats", type: "dashboard.stats" },
    ]);

    const result = heuristicRecommendations(doc, "dashboard metrics");
    const stats = result.suggestions.find((s) => s.type === "dashboard.stats");
    const chart = result.suggestions.find((s) => s.type === "dashboard.chart");

    expect(stats).toBeDefined();
    expect(chart).toBeDefined();
    expect(stats!.score).toBeLessThan(chart!.score);
  });

  it("only returns registered types, unique, sorted and capped by max", () => {
    const doc = makeDoc([]);
    const result = heuristicRecommendations(
      doc,
      "dashboard với biểu đồ, bảng đơn hàng, form thanh toán và ảnh banner",
      3,
    );

    expect(result.suggestions).toHaveLength(3);
    const types = result.suggestions.map((s) => s.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types.every((type) => knownComponentTypes.includes(type))).toBe(true);

    const scores = result.suggestions.map((s) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((score) => score >= 0 && score <= 100)).toBe(true);
  });

  it("falls back to basics when nothing matches", () => {
    const result = heuristicRecommendations(makeDoc([], "Untitled"));

    const types = result.suggestions.map((s) => s.type);
    expect(types).toContain("dashboard.header");
    expect(types).toContain("basic.text");
    expect(types).toContain("basic.button");
  });

  it("returns labels and categories from the registry", () => {
    const result = heuristicRecommendations(makeDoc([]), "đăng ký");
    const form = result.suggestions.find((s) => s.type === "formal.form");

    expect(form).toMatchObject({
      type: "formal.form",
      label: "Form",
      category: "formal",
    });
    expect(form!.reason.length).toBeGreaterThan(10);
  });
});
