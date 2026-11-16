// Client helpers for canvas review comments (plan/07 4.6). Threads are scoped
// to the active page and can optionally target one selected node.
import type {
  CommentListResponse,
  CommentStatus,
  CommentThreadDto,
  CreateCommentInput,
  ReplyCommentInput,
  UpdateCommentThreadInput,
} from "@ai-mockup-studio/shared-types";
import { getComponentDefinition, type UiNode } from "@ai-mockup-studio/ui-schema";
import { api } from "./api";

const ANCHOR_PROP_KEYS = ["label", "title", "text", "placeholder"] as const;

/** Human-readable anchor used in the comment list and composer chip. */
export function commentAnchorLabel(node: UiNode | null): string {
  if (!node) return "Toàn trang";

  for (const key of ANCHOR_PROP_KEYS) {
    const value = node.props?.[key];
    if (typeof value === "string" && value.trim()) {
      const text = value.trim().replace(/\s+/g, " ");
      return text.length > 48 ? `${text.slice(0, 45)}…` : text;
    }
  }

  const definition = getComponentDefinition(node.type);
  return definition?.label ?? node.type;
}

export function commentSnippet(body: string, max = 90): string {
  const text = body.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function listComments(
  projectId: string,
  pageId: string,
  status?: CommentStatus,
): Promise<CommentListResponse> {
  const params = new URLSearchParams({ pageId });
  if (status) params.set("status", status);
  return api.get<CommentListResponse>(
    `/projects/${projectId}/comments?${params.toString()}`,
  );
}

export function createComment(
  projectId: string,
  input: CreateCommentInput,
): Promise<CommentThreadDto> {
  return api.post<CommentThreadDto>(`/projects/${projectId}/comments`, input);
}

export function replyComment(
  projectId: string,
  threadId: string,
  input: ReplyCommentInput,
): Promise<CommentThreadDto> {
  return api.post<CommentThreadDto>(
    `/projects/${projectId}/comments/${threadId}/messages`,
    input,
  );
}

export function setCommentStatus(
  projectId: string,
  threadId: string,
  status: CommentStatus,
): Promise<CommentThreadDto> {
  const input: UpdateCommentThreadInput = { status };
  return api.patch<CommentThreadDto>(
    `/projects/${projectId}/comments/${threadId}`,
    input,
  );
}
