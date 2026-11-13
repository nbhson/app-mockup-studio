import { describe, expect, it } from "vitest";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { buildSampleDashboard, generateMockDocument } from "./sample-documents";

function collectIds(node: UiNode, ids: string[] = []): string[] {
  ids.push(node.id);
  for (const child of node.children ?? []) collectIds(child, ids);
  return ids;
}

const VIEWPORTS = [
  { mode: "desktop", width: 1440, height: 900 },
  { mode: "tablet", width: 768, height: 1024 },
  { mode: "mobile", width: 390, height: 844 },
] as const;

describe("sample documents", () => {
  it("builds a schema-valid dashboard with unique node ids", () => {
    const document = buildSampleDashboard();
    const parsed = uiDocumentSchema.safeParse(document);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);

    const ids = collectIds(document.root);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(10);
  });

  it.each(VIEWPORTS)("honours the $mode viewport", ({ mode, width, height }) => {
    const document = generateMockDocument("Dashboard doanh thu", mode);
    expect(document.viewport).toEqual({ width, height });
    expect(uiDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("derives the document name from the prompt and truncates long input", () => {
    expect(generateMockDocument("  Landing page CRM  ").name).toBe("Mockup: Landing page CRM");

    const longPrompt = "x".repeat(100);
    const name = generateMockDocument(longPrompt).name;
    expect(name).toBe(`Mockup: ${"x".repeat(40)}`);
  });
});
