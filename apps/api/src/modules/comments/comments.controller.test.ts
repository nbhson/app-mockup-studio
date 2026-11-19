import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { createFakeDb } from "../../common/testing/fake-db";
import { commentMessages, commentThreads } from "../../db/schema";
import { CommentsController } from "./comments.controller";

const req = { headers: {} } as unknown as Request;

function makeController(
  fake: ReturnType<typeof createFakeDb>,
  user: { id: string; email: string; name: string | null; role: string },
) {
  const access = { assertProjectRole: vi.fn(async () => user as never) };
  const controller = new CommentsController(fake.db, access as never);
  return { controller, access };
}

const threadRow = {
  id: "t1",
  projectId: "p1",
  pageId: "pg1",
  nodeId: null,
  nodeLabel: null,
  status: "open",
  createdBy: "Alice",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("CommentsController — write identity (fix H)", () => {
  const editor = { id: "u1", email: "alice@example.com", name: "Alice", role: "editor" };

  it("create requires the editor role (not viewer) and ignores a spoofed authorName", async () => {
    const fake = createFakeDb({
      select: [
        [{ id: "p1" }], // assertProject
        [{ id: "pg1", documentId: "d1" }], // assertPage
      ],
      insert: [
        [threadRow], // commentThreads.returning()
        [{ id: "m1", threadId: "t1", body: "Fix this", createdAt: new Date(), updatedAt: new Date(), authorName: "" }],
      ],
    });
    const { controller, access } = makeController(fake, editor);

    await controller.create(
      "p1",
      {
        pageId: "pg1",
        body: "Fix this",
        // impersonation attempt — must not reach the database
        authorName: "Owner Guy",
      },
      req,
    );

    expect(access.assertProjectRole).toHaveBeenCalledWith("p1", "editor", req);

    const threadInsert = fake.calls.find(
      (call) => call.op === "insert" && call.table === commentThreads,
    );
    expect((threadInsert?.values as { createdBy: string }).createdBy).toBe("Alice");

    const messageInsert = fake.calls.find(
      (call) => call.op === "insert" && call.table === commentMessages,
    );
    expect((messageInsert?.values as { authorName: string }).authorName).toBe("Alice");
  });

  it("create falls back to the identity email when the user has no display name", async () => {
    const fake = createFakeDb({
      select: [[{ id: "p1" }], [{ id: "pg1", documentId: "d1" }]],
      insert: [
        [threadRow],
        [{ id: "m1", threadId: "t1", body: "Hi", createdAt: new Date(), updatedAt: new Date(), authorName: "" }],
      ],
    });
    const { controller } = makeController(
      fake,
      { id: "u2", email: "bob@example.com", name: null, role: "editor" },
    );

    await controller.create("p1", { pageId: "pg1", body: "Hi" }, req);

    const messageInsert = fake.calls.find(
      (call) => call.op === "insert" && call.table === commentMessages,
    );
    expect((messageInsert?.values as { authorName: string }).authorName).toBe(
      "bob@example.com",
    );
  });

  it("reply requires editor and stamps the author from the identity", async () => {
    const fake = createFakeDb({
      select: [
        [{ id: "p1" }], // assertProject (inside getThread)
        [threadRow], // the thread
      ],
      insert: [[]], // commentMessages insert (not returned)
      update: [[threadRow]], // touch thread updatedAt
    });
    const { controller, access } = makeController(fake, editor);

    await controller.reply(
      "p1",
      "t1",
      { body: "Reply", authorName: "Someone Else" },
      req,
    );

    expect(access.assertProjectRole).toHaveBeenCalledWith("p1", "editor", req);
    const messageInsert = fake.calls.find(
      (call) => call.op === "insert" && call.table === commentMessages,
    );
    expect((messageInsert?.values as { authorName: string }).authorName).toBe(
      "Alice",
    );
  });

  it("a viewer's create is rejected with 403 before any DB write", async () => {
    const fake = createFakeDb({});
    const access = {
      assertProjectRole: vi.fn(async () => {
        throw new ForbiddenException("Cần quyền editor trở lên — bạn hiện là viewer");
      }),
    };
    const controller = new CommentsController(fake.db, access as never);

    await expect(
      controller.create("p1", { pageId: "pg1", body: "Nope" }, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("validates the node anchor against the page document when nodeId is given", async () => {
    const fake = createFakeDb({
      select: [
        [{ id: "p1" }],
        [{ id: "pg1", documentId: "d1" }],
        [{ schema: { root: { id: "root", type: "layout.container" } } }], // no "ghost" node
      ],
    });
    const { controller } = makeController(fake, editor);

    await expect(
      controller.create(
        "p1",
        { pageId: "pg1", nodeId: "ghost", body: "Anchor?" },
        req,
      ),
    ).rejects.toThrow(/không tồn tại/);
    expect(
      fake.calls.some((call) => call.op === "insert" && call.table === commentThreads),
    ).toBe(false);
  });
});
