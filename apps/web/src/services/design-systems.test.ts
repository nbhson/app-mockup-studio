import { describe, expect, it } from "vitest";
import type { DesignSystemDto } from "@ai-mockup-studio/shared-types";
import { SCHEMA_VERSION, type Theme, type UiDocument } from "@ai-mockup-studio/ui-schema";
import {
  designSystemExportFilename,
  designSystemFromDocument,
  parseDesignSystemTokens,
  serializeDesignSystemTokens,
} from "./design-systems";

const theme: Theme = {
  mode: "light",
  primary: "#2563EB",
  primaryForeground: "#FFFFFF",
  background: "#FFFFFF",
  foreground: "#0F172A",
  muted: "#F1F5F9",
  mutedForeground: "#64748B",
  border: "#E2E8F0",
  fontFamily: "Be Vietnam Pro",
  radius: 12,
};

function documentFixture(overrides: Partial<UiDocument> = {}): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-1",
    pageId: "page-1",
    name: "CRM Dashboard",
    viewport: { width: 1440, height: 900 },
    theme,
    root: { id: "root", type: "layout.container" },
    ...overrides,
  };
}

function systemFixture(overrides: Partial<DesignSystemDto> = {}): DesignSystemDto {
  return {
    id: "ds-1",
    name: "Brand Blue",
    description: "Token cho đội sản phẩm",
    theme,
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
    ...overrides,
  };
}

describe("design system token import/export", () => {
  it("creates a create-input from the document theme", () => {
    const input = designSystemFromDocument(
      documentFixture(),
      "  Brand Blue  ",
      "  Token chung  ",
    );
    expect(input).toEqual({
      name: "Brand Blue",
      description: "Token chung",
      theme,
    });
  });

  it("omits a blank description", () => {
    expect(designSystemFromDocument(documentFixture(), "Mono", "   ").description).toBeUndefined();
  });

  it("round-trips exported tokens", () => {
    const exported = serializeDesignSystemTokens(systemFixture());
    expect(() => JSON.parse(exported)).not.toThrow();

    const imported = parseDesignSystemTokens(exported);
    expect(imported).toEqual({
      name: "Brand Blue",
      description: "Token cho đội sản phẩm",
      theme,
    });
  });

  it("accepts a bare theme object and uses the fallback name", () => {
    const imported = parseDesignSystemTokens(JSON.stringify(theme), "From theme");
    expect(imported.name).toBe("From theme");
    expect(imported.theme).toEqual(theme);
    expect(imported.description).toBeUndefined();
  });

  it("rejects malformed JSON and incomplete themes", () => {
    expect(() => parseDesignSystemTokens("{")).toThrow(/JSON không hợp lệ/i);
    expect(() => parseDesignSystemTokens(JSON.stringify({ primary: "#fff" }))).toThrow(
      /Theme token/i,
    );
  });

  it("makes safe export filenames", () => {
    expect(designSystemExportFilename("Brand Blue / 2026 ✨")).toBe(
      "brand-blue-2026.tokens.json",
    );
    expect(designSystemExportFilename("   ")).toBe("design-system.tokens.json");
  });
});
