import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { documents, projectMembers, projects } from "../../db/schema";
import { ProjectsController } from "./projects.controller";

const req = { headers: {} } as unknown as Request;

describe("ProjectsController.remove — atomic cascade (fix K)", () => {
  it("deletes document, members and the project inside ONE transaction", async () => {
    const fake = createFakeDb({});
    const access = {
      assertProjectRole: vi.fn(async () => ({
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "owner",
      })),
    };
    const controller = new ProjectsController(fake.db, access as never);

    await controller.remove("p1", req);

    // Everything must happen inside the transaction callback: a mid-cascade
    // failure can no longer leave a project whose document/member rows are
    // already gone.
    expect(fake.txCount()).toBe(1);
    expect(fake.calls[0].op).toBe("transaction");
    const deletes = fake.calls
      .filter((call) => call.op === "delete")
      .map((call) => call.table);
    expect(deletes).toContain(documents);
    expect(deletes).toContain(projectMembers);
    expect(deletes).toContain(projects);
    // The project row is deleted LAST so its cascading FK children are still
    // resolvable while the explicit deletes run.
    expect(deletes[deletes.length - 1]).toBe(projects);
  });

  it("propagates a failure out of the transaction (callers see the error)", async () => {
    const fake = createFakeDb({ delete: [[], new Error("deadlock detected")] });
    const access = {
      assertProjectRole: vi.fn(async () => ({
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "owner",
      })),
    };
    const controller = new ProjectsController(fake.db, access as never);

    await expect(controller.remove("p1", req)).rejects.toThrow("deadlock detected");
  });
});
