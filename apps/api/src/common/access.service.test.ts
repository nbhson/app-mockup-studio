import { describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../common/testing/fake-db";
import { AccessService } from "./access.service";

const demo = { id: "u-demo", email: "demo@mockup.studio", name: "Demo User" };
const alice = { id: "u1", email: "alice@example.com", name: "Alice" };

function reqWith(header?: string): Request {
  return {
    headers: header === undefined ? {} : { "x-user-email": header },
  } as unknown as Request;
}

describe("AccessService identity resolution", () => {
  it("falls back to the demo user ONLY when no header is sent", async () => {
    const fake = createFakeDb({ select: [[demo]] });
    const access = new AccessService(fake.db);
    await expect(access.resolve(reqWith())).resolves.toEqual(demo);
  });

  it("never falls back to demo for an unknown header identity", async () => {
    const fake = createFakeDb({ select: [[]] });
    const access = new AccessService(fake.db);
    await expect(access.resolve(reqWith("ghost@example.com"))).resolves.toBeNull();
  });

  it("resolveEmail normalises case and whitespace", async () => {
    const fake = createFakeDb({ select: [[alice]] });
    const access = new AccessService(fake.db);
    const user = await access.resolveEmail("  ALICE@example.com ");
    expect(user?.id).toBe("u1");
  });
});

describe("AccessService.assertIdentifiedUser — writes to shared catalogs (fix L)", () => {
  it("401 when the request is anonymous (no x-user-email header)", async () => {
    const fake = createFakeDb({});
    const access = new AccessService(fake.db);
    await expect(access.assertIdentifiedUser(reqWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // Crucially: an empty header must NOT resolve to the demo owner either.
    await expect(
      access.assertIdentifiedUser(reqWith("   ")),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("401 for a header naming an unknown user (no silent demo fallback)", async () => {
    const fake = createFakeDb({ select: [[]] });
    const access = new AccessService(fake.db);
    await expect(
      access.assertIdentifiedUser(reqWith("attacker@evil.test")),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns the known user and never the demo row for identified writes", async () => {
    const fake = createFakeDb({ select: [[alice]] });
    const access = new AccessService(fake.db);
    await expect(access.assertIdentifiedUser(reqWith("alice@example.com"))).resolves.toEqual(
      alice,
    );
  });
});
