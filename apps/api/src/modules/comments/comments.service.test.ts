import { describe, expect, it } from "vitest";
import {
  normalizeCommentStatus,
  toCommentMessageDto,
  toCommentThreadDto,
} from "./comments.service";
import type { CommentMessageRow, CommentThreadRow } from "../../db/schema";

function threadRow(overrides: Partial<CommentThreadRow> = {}): CommentThreadRow {
  return {
    id: "thread-1",
    projectId: "project-1",
    pageId: "page-1",
    nodeId: "node-1",
    nodeLabel: "Nút lưu",
    status: "open",
    createdBy: "Demo User",
    createdAt: new Date("2026-11-16T08:00:00Z"),
    updatedAt: new Date("2026-11-16T08:05:00Z"),
    ...overrides,
  };
}

function messageRow(
  overrides: Partial<CommentMessageRow> = {},
): CommentMessageRow {
  return {
    id: "message-1",
    threadId: "thread-1",
    authorName: "Demo User",
    body: "Đổi màu nút này",
    createdAt: new Date("2026-11-16T08:00:00Z"),
    ...overrides,
  };
}

describe("comments service helpers", () => {
  it("normalizes unknown status values to open", () => {
    expect(normalizeCommentStatus("resolved")).toBe("resolved");
    expect(normalizeCommentStatus("open")).toBe("open");
    expect(normalizeCommentStatus("weird")).toBe("open");
  });

  it("maps a thread and its messages to DTOs", () => {
    const dto = toCommentThreadDto(threadRow(), [
      messageRow(),
      messageRow({
        id: "message-2",
        body: "Đã sửa",
        createdAt: new Date("2026-11-16T08:05:00Z"),
      }),
    ]);

    expect(dto).toMatchObject({
      id: "thread-1",
      projectId: "project-1",
      pageId: "page-1",
      nodeId: "node-1",
      nodeLabel: "Nút lưu",
      status: "open",
      createdBy: "Demo User",
    });
    expect(dto.createdAt).toBe("2026-11-16T08:00:00.000Z");
    expect(dto.messages.map((message) => message.body)).toEqual([
      "Đổi màu nút này",
      "Đã sửa",
    ]);
  });

  it("keeps page-level threads with null node fields", () => {
    const dto = toCommentThreadDto(
      threadRow({ nodeId: null, nodeLabel: null, status: "resolved" }),
      [],
    );
    expect(dto.nodeId).toBeNull();
    expect(dto.nodeLabel).toBeNull();
    expect(dto.status).toBe("resolved");
    expect(dto.messages).toEqual([]);
  });

  it("maps message timestamps to ISO strings", () => {
    expect(toCommentMessageDto(messageRow()).createdAt).toBe(
      "2026-11-16T08:00:00.000Z",
    );
  });
});
