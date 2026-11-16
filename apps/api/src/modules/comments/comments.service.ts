// ---------------------------------------------------------------------------
// Comment helpers (plan/07 4.6 — canvas review threads).
//
// A thread is anchored to a page and optionally to a node. Messages keep the
// conversation; resolving is a status change so history remains for review.
// ---------------------------------------------------------------------------

import type {
  CommentMessageDto,
  CommentStatus,
  CommentThreadDto,
} from "@ai-mockup-studio/shared-types";
import type { CommentMessageRow, CommentThreadRow } from "../../db/schema";

export const DEFAULT_COMMENT_AUTHOR = "Demo User";

export function normalizeCommentStatus(value: string): CommentStatus {
  return value === "resolved" ? "resolved" : "open";
}

export function toCommentMessageDto(row: CommentMessageRow): CommentMessageDto {
  return {
    id: row.id,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCommentThreadDto(
  row: CommentThreadRow,
  messages: CommentMessageRow[],
): CommentThreadDto {
  return {
    id: row.id,
    projectId: row.projectId,
    pageId: row.pageId,
    nodeId: row.nodeId ?? null,
    nodeLabel: row.nodeLabel ?? null,
    status: normalizeCommentStatus(row.status),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: messages.map(toCommentMessageDto),
  };
}
