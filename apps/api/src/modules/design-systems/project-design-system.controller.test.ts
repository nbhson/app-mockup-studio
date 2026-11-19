import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import {
  designSystems,
  documents,
  pages,
  projects,
} from "../../db/schema";
import { baseTheme } from "../../sample-documents";
import { DesignSystemsController } from "./design-systems.controller";
import { ProjectDesignSystemController } from "./project-design-system.controller";
import { blankDocument } from "../pages/pages.service";

const req = { headers: { "x-user-email": "alice@example.com" } } as unknown as Request;

describe("DesignSystemsController write gate (fix L)", () => {
  it("create rejects anonymous callers with 401 and touches no database rows", async () => {
    const fake = createFakeDb({});
    const access = {
      assertIdentifiedUser: vi.fn(async () => {
        throw new UnauthorizedException("Cần đăng nhập");
      }),
    };
    const controller = new DesignSystemsController(fake.db, access as never);

    await expect(
      controller.create({ name: "Acme", theme: baseTheme() }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fake.calls).toHaveLength(0);
    expect(access.assertIdentifiedUser).toHaveBeenCalledWith(req);
  });

  it("update and delete run the identity gate before mutating the catalog", async () => {
    const user = { id: "u1", email: "alice@example.com", name: "Alice" };
    const access = { assertIdentifiedUser: vi.fn(async () => user) };

    const existingRow = {
      id: "ds1",
      name: "Acme",
      description: null,
      theme: baseTheme(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fakeUpdate = createFakeDb({
      select: [[existingRow], []], // existing row; name-uniqueness check (no clash)
      update: [[existingRow]],
    });
    const controller = new DesignSystemsController(fakeUpdate.db, access as never);
    await controller.update("ds1", { name: "Acme" }, req);
    expect(
      fakeUpdate.calls.some((call) => call.op === "update" && call.table === designSystems),
    ).toBe(true);

    const fakeDelete = createFakeDb({
      delete: [[{ id: "ds1" }]],
      select: [[]], // list() after delete
    });
    const deleteController = new DesignSystemsController(fakeDelete.db, access as never);
    await deleteController.remove("ds1", req);
    expect(access.assertIdentifiedUser).toHaveBeenCalledTimes(2);
  });
});

describe("ProjectDesignSystemController.apply — presence broadcast (fix M)", () => {
  it("broadcasts a document update for every rewritten page after commit", async () => {
    const theme = baseTheme();
    const fake = createFakeDb({
      select: [
        [{ id: "p1" }], // assertProject
        [
          {
            id: "ds1",
            name: "Acme",
            description: null,
            theme,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ], // design system lookup
        // transaction: page rows with their documents
        [
          { id: "pg1", documentId: "d1" },
          { id: "pg2", documentId: "d2" },
        ],
        // transaction: the documents for those pages
        [
          {
            id: "d1",
            revision: 3,
            schema: blankDocument("One"),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "d2",
            revision: 9,
            schema: blankDocument("Two"),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
      // tx order: projects update, then one documents update per row
      update: [[], [], []],
    });

    const access = {
      assertProjectRole: vi.fn(async () => ({
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "editor",
      })),
    };
    const presence = { broadcastDocumentUpdate: vi.fn() };
    const controller = new ProjectDesignSystemController(
      fake.db,
      access as never,
      presence as never,
    );

    const result = await controller.apply(
      "p1",
      { designSystemId: "ds1" },
      req,
    );

    expect(result.updatedPages).toBe(2);
    expect(presence.broadcastDocumentUpdate).toHaveBeenCalledTimes(2);

    const first = presence.broadcastDocumentUpdate.mock.calls[0];
    expect(first[0]).toBe("p1");
    expect(first[1]).toMatchObject({ pageId: "pg1", actor: { email: "alice@example.com" } });
    expect(typeof first[1].updatedAt).toBe("string");

    const second = presence.broadcastDocumentUpdate.mock.calls[1];
    expect(second[1]).toMatchObject({ pageId: "pg2" });

    // Every document update bumped its revision inside the transaction.
    const docUpdates = fake.calls.filter(
      (call) => call.op === "update" && call.table === documents,
    );
    expect(docUpdates.map((call) => (call.set as { revision: number }).revision)).toEqual([
      4,
      10,
    ]);

    // And the project row itself points at the new system.
    const projectUpdate = fake.calls.find(
      (call) => call.op === "update" && call.table === projects,
    );
    expect((projectUpdate?.set as { designSystemId: string }).designSystemId).toBe("ds1");
    expect(fake.txCount()).toBe(1);
    void pages;
  });

  it("clearing the design system (null id) rewrites nothing and broadcasts nothing", async () => {
    const fake = createFakeDb({
      select: [[{ id: "p1" }]],
      update: [[]],
    });
    const access = {
      assertProjectRole: vi.fn(async () => ({
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "editor",
      })),
    };
    const presence = { broadcastDocumentUpdate: vi.fn() };
    const controller = new ProjectDesignSystemController(
      fake.db,
      access as never,
      presence as never,
    );

    const result = await controller.apply("p1", { designSystemId: null }, req);
    expect(result.updatedPages).toBe(0);
    expect(presence.broadcastDocumentUpdate).not.toHaveBeenCalled();
  });
});
