import { describe, expect, it } from "vitest";
import type { ComponentLibraryDto, LibraryExportPayload } from "@ai-mockup-studio/shared-types";
import {
  libraryExportFilename,
  parseLibraryImport,
  serializeLibrary,
} from "./component-libraries";

function libraryFixture(overrides: Partial<ComponentLibraryDto> = {}): ComponentLibraryDto {
  return {
    id: "lib-1",
    name: "SaaS Kit",
    description: "Thư viện chung cho SaaS",
    version: 2,
    components: [
      {
        id: "comp-1",
        libraryId: "lib-1",
        type: "layout.navbar",
        label: "Navbar",
        category: "navigation",
        schema: { id: "navbar", type: "layout.navbar", props: { title: "SaaS" }, children: [] },
        tags: ["nav"],
        createdAt: "2026-11-17T08:00:00.000Z",
      },
    ],
    createdAt: "2026-11-17T08:00:00.000Z",
    updatedAt: "2026-11-17T09:00:00.000Z",
    ...overrides,
  };
}

describe("component library export/import", () => {
  it("round-trips a serialized library", () => {
    const lib = libraryFixture();
    const exported = serializeLibrary(lib);
    expect(() => JSON.parse(exported)).not.toThrow();

    const imported = parseLibraryImport(exported);
    expect(imported.kind).toBe("ai-mockup-studio/component-library");
    expect(imported.name).toBe("SaaS Kit");
    expect(imported.components).toHaveLength(1);
    expect(imported.components[0]?.type).toBe("layout.navbar");
    expect(imported.components[0]?.schema).toEqual({
      id: "navbar",
      type: "layout.navbar",
      props: { title: "SaaS" },
      children: [],
    });
  });

  it("rejects malformed JSON and non-library objects", () => {
    expect(() => parseLibraryImport("not json {")).toThrow(/JSON không hợp lệ/);
    expect(() => parseLibraryImport(JSON.stringify({ hello: "world" }))).toThrow(
      /không phải component library/,
    );
    expect(() =>
      parseLibraryImport(
        JSON.stringify({ kind: "ai-mockup-studio/component-library" }),
      ),
    ).toThrow(/components/);
  });

  it("uses the fallback name for a nameless library", () => {
    const imported = parseLibraryImport(
      JSON.stringify({
        kind: "ai-mockup-studio/component-library",
        components: [{ type: "basic.text", label: "T", schema: {}, tags: [] }],
      }),
    );
    expect(imported.name).toBe("Imported library");
    expect(imported.components[0]?.label).toBe("T");
  });

  it("normalizes malformed component fields", () => {
    const imported = parseLibraryImport(
      JSON.stringify({
        kind: "ai-mockup-studio/component-library",
        name: "Kit",
        components: [
          { type: 5, label: "x", schema: {} },
          { type: "basic.text", label: "ok", schema: {}, tags: ["a", 3, "b"] },
        ],
      }),
    );
    expect(imported.components[0]?.type).toBe("layout.container");
    expect(imported.components[0]?.label).toBe("x");
    expect(imported.components[1]?.tags).toEqual(["a", "b"]);
  });

  it("makes safe export filenames", () => {
    expect(libraryExportFilename("SaaS Kit / 2026 ✨")).toBe("saas-kit-2026.library.json");
    expect(libraryExportFilename("   ")).toBe("component-library.library.json");
  });

  it("serializes a payload type compatible with the export contract", () => {
    const lib = libraryFixture();
    const payload = JSON.parse(serializeLibrary(lib)) as LibraryExportPayload;
    expect(payload.components[0]).not.toHaveProperty("id");
    expect(payload.components[0]?.tags).toEqual(["nav"]);
  });
});
