import { describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { documents, pages, versions } from "../../db/schema";
import { PagesController } from "./pages.controller";
import { blankDocument, type PageRow } from "./pages.service";

const req = { headers: {} } as unknown as Request;

function fakePage(overrides: Partial<PageRow> = {}): PageRow {
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

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    projectId: "p1",
    schemaVersion: "0.1.0",
    schema: blankDocument("Home"),
    revision: 7,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeController(fake: ReturnType<typeof createFakeDb>) {
  const access = {
    assertProjectRole: vi.fn(async () => ({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      role: "editor",
    })),
  };
  const presence = { broadcastDocumentUpdate: vi.fn() };
  const controller = new PagesController(
    fake.db,
    access as never,
    presence as never,
  );
  return { controller, access, presence };
}

describe("PagesController.save — optimistic concurrency (fix F)", () => {
  it("rejects a save WITHOUT baseVersion with 409 instead of a blind write", async () => {
    const fake = createFakeDb({
      select: [[fakePage()], [fakeDoc()]],
    });
    const { controller } = makeController(fake);

    await expect(
      controller.save("p1", "pg1", { document: blankDocument("Home") }, req),
    ).rejects.toBeInstanceOf(ConflictException);

    // Nothing was written: neither documents nor versions were touched.
    expect(
      fake.calls.some((call) => call.op === "update" && call.table === documents),
    ).toBe(false);
    expect(fake.calls.some((call) => call.op === "insert")).toBe(false);
  });

  it("rejects a stale baseVersion and reports the current revision", async () => {
    const fake = createFakeDb({ select: [[fakePage()], [fakeDoc()]] });
    const { controller } = makeController(fake);

    await expect(
      controller.save(
        "p1",
        "pg1",
        { document: blankDocument("Home"), baseVersion: "6" },
        req,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("writes with a revision guard inside ONE transaction and broadcasts", async () => {
    const savedDoc = fakeDoc({ revision: 8, updatedAt: new Date("2026-02-01T00:00:00Z") });
    const fake = createFakeDb({
      select: [
        [fakePage()], // findPage
        [fakeDoc()], // existing document, revision 7
        [], // last autosave: none exists → snapshot needed
      ],
      insert: [[]], // versions snapshot row (no returning used)
      update: [[savedDoc], [fakePage()], []], // documents, pages, projects
    });
    const { controller, presence } = makeController(fake);

    const result = await controller.save(
      "p1",
      "pg1",
      { document: blankDocument("Home"), baseVersion: "7" },
      req,
    );

    expect(result.revision).toBe(8);
    expect(presence.broadcastDocumentUpdate).toHaveBeenCalledWith("p1", {
      pageId: "pg1",
      updatedAt: "2026-02-01T00:00:00.000Z",
      actor: { email: "alice@example.com" },
    });
    expect(fake.txCount()).toBe(1); // snapshot + guarded update share one tx

    const docUpdate = fake.calls.find(
      (call) => call.op === "update" && call.table === documents,
    );
    expect(docUpdate?.set).toMatchObject({ revision: 8 });
  });

  it("maps a lost revision race (guarded update matches 0 rows) to 409", async () => {
    const fake = createFakeDb({
      select: [[fakePage()], [fakeDoc()], []],
      insert: [[]],
      update: [[], [], []], // documents update matched nothing — concurrent bump
    });
    const { controller, presence } = makeController(fake);

    await expect(
      controller.save(
        "p1",
        "pg1",
        { document: blankDocument("Home"), baseVersion: "7" },
        req,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(presence.broadcastDocumentUpdate).not.toHaveBeenCalled();
  });

  it("skips the autosave snapshot when a recent version exists", async () => {
    const savedDoc = fakeDoc({ revision: 8 });
    const fake = createFakeDb({
      select: [
        [fakePage()],
        [fakeDoc()],
        [{ createdAt: new Date() }], // version younger than 5 minutes
      ],
      update: [[savedDoc], [fakePage()], []],
    });
    const { controller } = makeController(fake);

    await controller.save(
      "p1",
      "pg1",
      { document: blankDocument("Home"), baseVersion: "7" },
      req,
    );
    expect(
      fake.calls.some((call) => call.op === "insert" && call.table === versions),
    ).toBe(false);
  });
});

describe("PagesController.create — slug race retry (fix G)", () => {
  it("recomputes the slug once when a concurrent create won the unique index", async () => {
    const doc1 = { id: "d-a", schema: blankDocument("New Page"), updatedAt: new Date(), revision: 0 };
    const doc2 = { id: "d-b", schema: blankDocument("New Page"), updatedAt: new Date(), revision: 0 };
    const fake = createFakeDb({
      select: [
        [{ id: "p1" }], // assertProject
        [], // uniqueSlug: "new-page" free (first attempt)
        [{ position: 0 }], // existing positions
        [fakePage({ slug: "new-page", id: "pg-x" })], // retry: base now taken
        [], // retry: "new-page-2" free
      ],
      insert: [
        [doc1],
        Object.assign(new Error('duplicate key value violates unique constraint "pages_project_slug_key"'), { code: "23505" }),
        [doc2],
        [fakePage({ id: "pg9", slug: "new-page-2", documentId: "d-b" })],
      ],
    });
    const { controller } = makeController(fake);

    const result = await controller.create(
      "p1",
      { name: "New Page" },
      req,
    );

    expect(result.page.slug).toBe("new-page-2");
    const pageInserts = fake.calls.filter(
      (call) => call.op === "insert" && call.table === pages,
    );
    expect(pageInserts).toHaveLength(2);
    expect(pageInserts[1].values).toMatchObject({ slug: "new-page-2" });
    expect(fake.txCount()).toBe(2); // each attempt gets its own transaction
  });

  it("does NOT swallow non-unique-violation failures", async () => {
    const doc1 = { id: "d-a", schema: blankDocument("New Page"), updatedAt: new Date(), revision: 0 };
    const fake = createFakeDb({
      select: [[{ id: "p1" }], [], [{ position: 0 }]],
      insert: [[doc1], new Error("connection terminated")],
    });
    const { controller } = makeController(fake);

    await expect(
      controller.create("p1", { name: "New Page" }, req),
    ).rejects.toThrow("connection terminated");
  });
});
