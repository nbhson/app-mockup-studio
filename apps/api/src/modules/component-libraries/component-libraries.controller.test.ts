import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { componentLibraries } from "../../db/schema";
import { ComponentLibrariesController } from "./component-libraries.controller";

const req = { headers: {} } as unknown as Request;

describe("ComponentLibrariesController write gate (fix L)", () => {
  it("rejects anonymous create/import/delete with 401 before touching the DB", async () => {
    const fake = createFakeDb({});
    const access = {
      assertIdentifiedUser: vi.fn(async () => {
        throw new UnauthorizedException("Cần đăng nhập");
      }),
    };
    const controller = new ComponentLibrariesController(fake.db, access as never);

    await expect(
      controller.create({ name: "Lib" }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.importLibrary({ kind: "ai-mockup-studio/component-library" }, req),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.remove("lib1", req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("lets an identified user through and inserts the library row", async () => {
    const user = { id: "u1", email: "alice@example.com", name: "Alice" };
    const access = { assertIdentifiedUser: vi.fn(async () => user) };
    const fake = createFakeDb({
      select: [[]], // no name clash
      insert: [
        [
          {
            id: "lib1",
            name: "Acme UI",
            description: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    });
    const controller = new ComponentLibrariesController(fake.db, access as never);

    const dto = await controller.create({ name: "Acme UI" }, req);
    expect(dto.name).toBe("Acme UI");
    expect(
      fake.calls.some(
        (call) => call.op === "insert" && call.table === componentLibraries,
      ),
    ).toBe(true);
  });

  it("reads stay public (no identity gate on list/get/export)", async () => {
    const fake = createFakeDb({ select: [[]] });
    const access = {
      assertIdentifiedUser: vi.fn(() => {
        throw new Error("must not be called for reads");
      }),
    };
    const controller = new ComponentLibrariesController(fake.db, access as never);

    await expect(controller.list()).resolves.toEqual({ libraries: [] });
    expect(access.assertIdentifiedUser).not.toHaveBeenCalled();
  });
});
