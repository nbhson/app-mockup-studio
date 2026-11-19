import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { projectMembers, users } from "../../db/schema";
import { MembersController } from "./members.controller";

const req = { headers: {} } as unknown as Request;

function makeController(fake: ReturnType<typeof createFakeDb>) {
  const access = {
    assertProjectRole: vi.fn(async () => ({
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    })),
    getOwner: vi.fn(async () => ({
      id: "u-owner",
      email: "owner@example.com",
      name: "Owner",
    })),
  };
  const controller = new MembersController(fake.db, access as never);
  return { controller, access };
}

const bob = { id: "u2", email: "bob@example.com", name: "Bob" };

describe("MembersController.add — duplicate-member contract (fix J)", () => {
  it("pre-check duplicate uses the unified Vietnamese wording", async () => {
    const fake = createFakeDb({
      select: [[bob], [{ id: "pm-existing" }]], // user found; already a member
    });
    const { controller } = makeController(fake);

    await expect(
      controller.add(req, "p1", { email: "bob@example.com", role: "editor" }),
    ).rejects.toThrow("Người dùng này đã là thành viên của dự án.");
  });

  it("a lost insert race maps SQLSTATE 23505 to the same 400 — no driver leak", async () => {
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "project_members_project_id_user_id_key"',
      ),
      { code: "23505" },
    );
    const fake = createFakeDb({
      select: [[bob], []], // user found; pre-check says NOT a member
      insert: [driverError],
    });
    const { controller } = makeController(fake);

    const error = await controller
      .add(req, "p1", { email: "bob@example.com", role: "editor" })
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(BadRequestException);
    // The response must not echo the constraint name / driver text.
    const response = (error.getResponse() ?? {}) as { message?: string };
    expect(response.message).toBe("Người dùng này đã là thành viên của dự án.");
    expect(JSON.stringify(response)).not.toMatch(/duplicate key|project_members_/i);
  });

  it("unrelated DB failures are re-thrown untouched", async () => {
    const fake = createFakeDb({
      select: [[bob], []],
      insert: [new Error("connection terminated unexpectedly")],
    });
    const { controller } = makeController(fake);

    await expect(
      controller.add(req, "p1", { email: "bob@example.com", role: "editor" }),
    ).rejects.toThrow("connection terminated unexpectedly");
  });

  it("happy path inserts the member row and returns the DTO", async () => {
    const fake = createFakeDb({
      select: [[bob], []],
      insert: [
        [
          {
            id: "pm1",
            projectId: "p1",
            userId: "u2",
            role: "editor",
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      ],
    });
    const { controller } = makeController(fake);

    const dto = await controller.add(req, "p1", {
      email: "bob@example.com",
      role: "editor",
    });
    expect(dto.user.email).toBe("bob@example.com");
    expect(dto.role).toBe("editor");
    expect(
      fake.calls.some((call) => call.op === "insert" && call.table === projectMembers),
    ).toBe(true);
    expect(
      fake.calls.some((call) => call.op === "select" && call.table === users),
    ).toBe(true);
  });

  it("refuses to add the implicit owner", async () => {
    const fake = createFakeDb({ select: [[{ id: "u-owner", email: "owner@example.com", name: "Owner" }]] });
    const { controller } = makeController(fake);
    await expect(
      controller.add(req, "p1", { email: "owner@example.com", role: "viewer" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
