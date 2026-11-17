import { describe, expect, it } from "vitest";
import type { LibraryExportPayload } from "@ai-mockup-studio/shared-types";
import type { ComponentLibraryRow, LibraryComponentRow } from "../../db/schema";
import {
  buildExportPayload,
  toComponentDto,
  toLibraryDto,
  validateComponentSchema,
} from "./component-libraries.service";

const libraryRow: ComponentLibraryRow = {
  id: "lib-1",
  name: "SaaS Kit",
  description: "Component chung cho sản phẩm SaaS",
  version: 3,
  createdAt: new Date("2026-11-17T08:00:00Z"),
  updatedAt: new Date("2026-11-17T09:00:00Z"),
};

const componentRows: LibraryComponentRow[] = [
  {
    id: "comp-1",
    libraryId: "lib-1",
    type: "layout.navbar",
    label: "Navbar",
    category: "navigation",
    schema: {
      id: "navbar",
      type: "layout.navbar",
      props: { title: "SaaS" },
      children: [],
    },
    tags: ["nav", "header"],
    createdAt: new Date("2026-11-17T08:30:00Z"),
  },
  {
    id: "comp-2",
    libraryId: "lib-1",
    type: "formal.form",
    label: "Login form",
    category: "forms",
    schema: { id: "login", type: "formal.form", children: [] },
    tags: ["auth"],
    createdAt: new Date("2026-11-17T08:45:00Z"),
  },
];

describe("component libraries service", () => {
  it("maps a library row with its components to a DTO", () => {
    const dto = toLibraryDto(libraryRow, componentRows);
    expect(dto.id).toBe("lib-1");
    expect(dto.name).toBe("SaaS Kit");
    expect(dto.description).toBe("Component chung cho sản phẩm SaaS");
    expect(dto.version).toBe(3);
    expect(dto.components).toHaveLength(2);
    expect(dto.components[0]?.type).toBe("layout.navbar");
    expect(dto.createdAt).toBe("2026-11-17T08:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-11-17T09:00:00.000Z");
  });

  it("keeps null descriptions", () => {
    const dto = toLibraryDto({ ...libraryRow, description: null }, []);
    expect(dto.description).toBeNull();
  });

  it("maps a component row without leaking the schema", () => {
    const dto = toComponentDto(componentRows[0]!);
    expect(dto.libraryId).toBe("lib-1");
    expect(dto.label).toBe("Navbar");
    expect(dto.category).toBe("navigation");
    expect(dto.schema).toEqual({ id: "navbar", type: "layout.navbar", props: { title: "SaaS" }, children: [] });
    expect(dto.tags).toEqual(["nav", "header"]);
  });

  it("builds a portable export payload", () => {
    const lib = toLibraryDto(libraryRow, componentRows);
    const payload: LibraryExportPayload = buildExportPayload(lib);
    expect(payload.kind).toBe("ai-mockup-studio/component-library");
    expect(payload.name).toBe("SaaS Kit");
    expect(payload.description).toBe("Component chung cho sản phẩm SaaS");
    expect(payload.components).toHaveLength(2);
    expect(payload.components[0]).not.toHaveProperty("id");
    expect(payload.components[0]?.schema).toEqual(componentRows[0]!.schema);
  });

  it("validates nested component schemas", () => {
    expect(validateComponentSchema({ id: "a", type: "basic.text" })).toBe(true);
    expect(
      validateComponentSchema({
        id: "root",
        type: "layout.container",
        children: [
          { id: "child", type: "basic.button" },
          { id: "grand", type: "layout.container", children: [{ id: "leaf", type: "basic.text" }] },
        ],
      }),
    ).toBe(true);
    expect(validateComponentSchema(null)).toBe(false);
    expect(validateComponentSchema({ type: "basic.text" })).toBe(false);
    expect(validateComponentSchema({ id: "a", type: "basic.text", children: [{ id: "b" }] })).toBe(false);
  });
});
