import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type UiDocument, type UiNode } from "@ai-mockup-studio/ui-schema";
import { exportDocumentToHtml, resolveDocument, type ResolvedElement } from "./index";

// ---------------------------------------------------------------------------
// Performance guard (plan/12 GĐ 6.2): a 600-node document must resolve and
// export without pathological slowdown. Thresholds are intentionally generous
// so slow CI machines do not flake; they catch accidental O(n²) regressions.
// ---------------------------------------------------------------------------

function makeLargeDoc(nodeCount: number): UiDocument {
  const children: UiNode[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const type =
      index % 5 === 0 ? "basic.button" : index % 7 === 0 ? "dashboard.stats" : "basic.text";
    children.push({
      id: `node-${index}`,
      type,
      props:
        type === "basic.button"
          ? { label: `Action ${index}` }
          : type === "dashboard.stats"
            ? { items: ["A", "B"], values: ["1", "2"] }
            : { text: `Row ${index}` },
      styles: { padding: 8, fontSize: 14 },
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-perf",
    pageId: "page-perf",
    name: "Performance 600",
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
    root: { id: "root", type: "layout.container", children },
  };
}

function countResolved(element: ResolvedElement): number {
  return 1 + (element.children ?? []).reduce((total, child) => total + countResolved(child), 0);
}

describe("large document performance", () => {
  it("resolves 600+ nodes and exports HTML within budget", () => {
    const doc = makeLargeDoc(600);

    const resolveStart = performance.now();
    const resolved = resolveDocument(doc);
    const resolveMs = performance.now() - resolveStart;

    expect(countResolved(resolved)).toBe(601);
    // Typical local time is single-digit ms; 250 ms is a regression guard.
    expect(resolveMs).toBeLessThan(250);

    const exportStart = performance.now();
    const html = exportDocumentToHtml(doc);
    const exportMs = performance.now() - exportStart;

    expect(html).toContain("Row 599");
    expect(exportMs).toBeLessThan(1000);

    console.log(
      `[perf] 601 nodes: resolve ${resolveMs.toFixed(1)}ms · html export ${exportMs.toFixed(1)}ms (${(
        html.length / 1024
      ).toFixed(1)} kB)`,
    );
  });
});
