import { describe, expect, it } from "vitest";
import { createFakeDb } from "../../common/testing/fake-db";
import { documents, pages, projects } from "../../db/schema";
import {
  ensureHomePage,
  slugify,
  uniqueSlug,
  type PageRow,
} from "./pages.service";

function pageRow(overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: "pg1",
    projectId: "p1",
    name: "Home",
    slug: "home",
    position: 0,
    documentId: "d1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("slugify", () => {
  it("transliterates Vietnamese diacritics and falls back to 'page'", () => {
    expect(slugify("Trang chủ")).toBe("trang-chu");
    expect(slugify("ĐĂNG NHẬP")).toBe("dang-nhap");
    expect(slugify("!!!")).toBe("page");
  });
});

describe("uniqueSlug", () => {
  it("returns the desired slug when free, and -2/-3 suffixes on conflict", async () => {
    const fake = createFakeDb({ select: [[], [pageRow()], []] });
    await expect(uniqueSlug(fake.db, "p1", "Home")).resolves.toBe("home");

    const again = createFakeDb({ select: [[pageRow()], [pageRow()], []] });
    await expect(uniqueSlug(again.db, "p1", "Home")).resolves.toBe("home-3");
  });
});

describe("ensureHomePage", () => {
  it("returns the first existing page without inserting", async () => {
    const fake = createFakeDb({ select: [[pageRow()]] });
    const page = await ensureHomePage(fake.db, "p1");
    expect(page?.id).toBe("pg1");
    expect(fake.calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("wraps the deterministic legacy document and points currentPageId at it", async () => {
    const fake = createFakeDb({
      select: [
        [], // no pages yet
        [{ id: "d1", schema: { name: "Trang chủ" } }], // legacy document
        [], // uniqueSlug("home") free
      ],
      insert: [[pageRow()]],
    });
    const page = await ensureHomePage(fake.db, "p1");
    expect(page?.slug).toBe("home");
    expect(page?.documentId).toBe("d1");

    const projectUpdate = fake.calls.find(
      (call) => call.op === "update" && call.table === projects,
    );
    expect((projectUpdate?.set as { currentPageId: string }).currentPageId).toBe(
      "pg1",
    );
  });

  it("loses a concurrent-create race gracefully: ON CONFLICT + re-select, no throw", async () => {
    const winner = pageRow({ id: "pg-winner", slug: "home", documentId: "d1" });
    const fake = createFakeDb({
      select: [
        [], // no pages yet
        [{ id: "d1", schema: { name: "Home" } }], // legacy document
        [], // uniqueSlug("home") looks free...
        [winner], // ...but the INSERT lost the race; re-select finds the winner
      ],
      // insert resolves to NO rows: the ON CONFLICT DO NOTHING path.
      insert: [[]],
    });

    const page = await ensureHomePage(fake.db, "p1");
    // Without the fix this crashed on `page.id` of an undefined row (500).
    expect(page?.id).toBe("pg-winner");

    const pageInsert = fake.calls.find(
      (call) => call.op === "insert" && call.table === pages,
    );
    expect(pageInsert?.methods).toContain("onConflictDoNothing");
    expect(pageInsert?.methods).toContain("returning");

    // currentPageId must follow the row that actually won the race.
    const projectUpdate = fake.calls.find(
      (call) => call.op === "update" && call.table === projects,
    );
    expect((projectUpdate?.set as { currentPageId: string }).currentPageId).toBe(
      "pg-winner",
    );
  });

  it("re-reads the document list deterministically (ordered select on documents)", async () => {
    const fake = createFakeDb({
      select: [[], [{ id: "d1", schema: {} }], []],
      insert: [[pageRow()]],
    });
    await ensureHomePage(fake.db, "p1");
    const docSelect = fake.calls.find(
      (call) => call.op === "select" && call.table === documents,
    );
    expect(docSelect?.methods).toContain("orderBy");
  });
});
