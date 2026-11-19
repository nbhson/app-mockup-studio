import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { organizationMembers } from "../../db/schema";
import { OrganizationsController } from "./organizations.controller";

const req = { headers: {} } as unknown as Request;

function makeController(fake: ReturnType<typeof createFakeDb>) {
  const access = {
    assertOrgRole: vi.fn(async () => ({
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    })),
    resolve: vi.fn(async () => ({
      id: "u-admin",
      email: "admin@example.com",
      name: "Admin",
    })),
    getOrgRole: vi.fn(async () => "admin" as const),
  };
  return new OrganizationsController(fake.db, access as never);
}

const carol = { id: "u3", email: "carol@example.com", name: "Carol" };

describe("OrganizationsController.addMember — duplicate contract mirrors projects (fix J)", () => {
  it("lost insert race on (organization_id, user_id) yields the unified 400", async () => {
    const driverError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "organization_members_organization_id_user_id_key"',
      ),
      { code: "23505" },
    );
    // select order: user lookup, organization owner check, existing member
    const fake = createFakeDb({
      select: [[carol], [{ ownerId: "u-admin" }], []],
      insert: [driverError],
    });
    const controller = makeController(fake);

    const error = await controller
      .addMember(req, "org1", { email: "carol@example.com", role: "member" })
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error.getResponse() ?? {}) as { message?: string };
    expect(response.message).toBe("Người dùng này đã là thành viên của tổ chức.");
    expect(JSON.stringify(response)).not.toMatch(/duplicate key|organization_members_/i);
  });

  it("pre-check duplicate gives the exact same wording as the race path", async () => {
    const fake = createFakeDb({
      select: [[carol], [{ ownerId: "u-admin" }], [{ id: "om-existing" }]],
    });
    const controller = makeController(fake);

    await expect(
      controller.addMember(req, "org1", { email: "carol@example.com", role: "member" }),
    ).rejects.toThrow("Người dùng này đã là thành viên của tổ chức.");
    expect(
      fake.calls.some((call) => call.op === "insert" && call.table === organizationMembers),
    ).toBe(false);
  });
});
