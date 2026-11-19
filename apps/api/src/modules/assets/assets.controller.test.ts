import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { assets } from "../../db/schema";
import { AssetsController } from "./assets.controller";

const req = { headers: {} } as unknown as Request;

function makeResponse() {
  const headers: Record<string, string> = {};
  let ended: Buffer | undefined;
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(data: Buffer) {
      ended = data;
    },
  } as unknown as Response;
  return { res, headers, get body() { return ended; } };
}

function makeController(fake: ReturnType<typeof createFakeDb>) {
  const access = {
    assertProjectRole: vi.fn(async () => ({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      role: "viewer",
    })),
  };
  return new AssetsController(fake.db, access as never);
}

describe("AssetsController.raw — caching & filename hardening (fix K)", () => {
  it("serves authenticated project assets with PRIVATE caching only", async () => {
    const png = Buffer.from("fake-png-bytes");
    const fake = createFakeDb({
      select: [
        [
          {
            id: "a1",
            projectId: "p1",
            fileName: "ảnh nền hero".repeat(2) + 'x".bin\r\n',
            mimeType: "image/png",
            data: png.toString("base64"),
            size: png.length,
            createdAt: new Date(),
          },
        ],
      ],
    });
    const controller = makeController(fake);
    const { res, headers } = makeResponse();

    await controller.raw("p1", "a1", req, res);

    // Shared caches (CDN/proxy) must never store per-tenant project media.
    expect(headers["Cache-Control"]).toBe("private, max-age=31536000, immutable");
    expect(headers["Cache-Control"]).not.toMatch(/\bpublic\b/);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("sanitizes quotes/CR/LF from the ASCII filename and adds RFC 5987 filename*", async () => {
    const png = Buffer.from("fake-png-bytes");
    const tricky = 'ảnh "nền"\r\n;evil.txt';
    const fake = createFakeDb({
      select: [
        [
          {
            id: "a1",
            projectId: "p1",
            fileName: tricky,
            mimeType: "image/png",
            data: png.toString("base64"),
            size: png.length,
            createdAt: new Date(),
          },
        ],
      ],
    });
    const controller = makeController(fake);
    const { res, headers } = makeResponse();

    await controller.raw("p1", "a1", req, res);

    const disposition = headers["Content-Disposition"];
    expect(disposition.startsWith("inline;")).toBe(true);
    // Header injection is impossible: no raw CR/LF anywhere in the value.
    expect(disposition).not.toMatch(/[\r\n]/);
    // The fallback filename has no unescaped quotes/backslashes...
    const fallback = disposition.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(fallback).not.toContain('"');
    expect(fallback).not.toContain("\\");
    // ...and the true name is percent-encoded UTF-8.
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent(tricky).replace(/%20/g, "+")}`);
  });

  it("still scopes lookups by BOTH asset id and project id (404 across tenants)", async () => {
    const fake = createFakeDb({
      select: [[{ id: "a1", projectId: "OTHER", data: "", fileName: "x", mimeType: "image/png", size: 0, createdAt: new Date() }]],
    });
    const controller = makeController(fake);
    const { res } = makeResponse();
    await expect(controller.raw("p1", "a1", req, res)).rejects.toThrow();
    expect(
      fake.calls.some((call) => call.op === "select" && call.table === assets),
    ).toBe(true);
  });
});
