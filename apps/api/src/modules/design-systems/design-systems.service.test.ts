import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Theme, type UiDocument } from "@ai-mockup-studio/ui-schema";
import { applyThemeToDocument, toDesignSystemDto } from "./design-systems.service";
import type { DesignSystemRow } from "../../db/schema";

const theme: Theme = {
  mode: "light",
  primary: "#2563EB",
  primaryForeground: "#ffffff",
  background: "#ffffff",
  foreground: "#0F172A",
  muted: "#F1F5F9",
  mutedForeground: "#64748B",
  border: "#E2E8F0",
  fontFamily: "Inter",
  radius: 8,
};

describe("design systems service", () => {
  it("maps a row to a DTO with its theme tokens", () => {
    const row: DesignSystemRow = {
      id: "ds-1",
      name: "Brand Blue",
      description: "Màu chủ đạo cho dashboard",
      theme,
      createdAt: new Date("2026-11-16T08:00:00Z"),
      updatedAt: new Date("2026-11-16T08:10:00Z"),
    };

    expect(toDesignSystemDto(row)).toEqual({
      id: "ds-1",
      name: "Brand Blue",
      description: "Màu chủ đạo cho dashboard",
      theme,
      createdAt: "2026-11-16T08:00:00.000Z",
      updatedAt: "2026-11-16T08:10:00.000Z",
    });
  });

  it("keeps null descriptions", () => {
    const dto = toDesignSystemDto({
      id: "ds-2",
      name: "Mono",
      description: null,
      theme,
      createdAt: new Date("2026-11-16T08:00:00Z"),
      updatedAt: new Date("2026-11-16T08:00:00Z"),
    });
    expect(dto.description).toBeNull();
  });

  it("replaces only the theme when applying a design system", () => {
    const doc: UiDocument = {
      schemaVersion: SCHEMA_VERSION,
      id: "doc-1",
      pageId: "page-1",
      name: "Dashboard",
      viewport: { width: 1440, height: 900 },
      theme: { ...theme, primary: "#000000" },
      root: {
        id: "root",
        type: "layout.container",
        children: [{ id: "btn", type: "basic.button", props: { label: "Lưu" } }],
      },
    };

    const next = applyThemeToDocument(doc, theme);

    expect(next.theme).toEqual(theme);
    expect(next.root).toBe(doc.root);
    expect(next.name).toBe(doc.name);
    expect(next.viewport).toEqual(doc.viewport);
    expect(doc.theme.primary).toBe("#000000");
  });
});
