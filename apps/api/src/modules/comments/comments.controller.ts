import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type {
  CommentListResponse,
  CommentThreadDto,
  CreateCommentInput,
  ReplyCommentInput,
  UpdateCommentThreadInput,
} from "@ai-mockup-studio/shared-types";
import {
  createCommentSchema,
  replyCommentSchema,
  updateCommentThreadSchema,
} from "@ai-mockup-studio/validators";
import { DbService } from "../../db/db.service";
import {
  commentMessages,
  commentThreads,
  pages,
  projects,
} from "../../db/schema";
import {
  DEFAULT_COMMENT_AUTHOR,
  toCommentThreadDto,
} from "./comments.service";

/**
 * Canvas review comments (plan/07 4.6). Threads live under a project and are
 * scoped to one page; a thread may additionally target a specific node.
 */
@Controller("projects/:projectId/comments")
export class CommentsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(
    @Param("projectId") projectId: string,
    @Query("pageId") pageId?: string,
    @Query("status") status?: string,
  ): Promise<CommentListResponse> {
    await this.assertProject(projectId);
    if (pageId) await this.assertPage(projectId, pageId);

    if (status && status !== "open" && status !== "resolved") {
      throw new BadRequestException("status phải là open hoặc resolved");
    }

    const conditions = [eq(commentThreads.projectId, projectId)];
    if (pageId) conditions.push(eq(commentThreads.pageId, pageId));
    if (status) conditions.push(eq(commentThreads.status, status));

    const threads = await this.db.client
      .select()
      .from(commentThreads)
      .where(and(...conditions))
      .orderBy(desc(commentThreads.updatedAt));

    const ids = threads.map((thread) => thread.id);
    const messages =
      ids.length > 0
        ? await this.db.client
            .select()
            .from(commentMessages)
            .where(inArray(commentMessages.threadId, ids))
            .orderBy(asc(commentMessages.createdAt))
        : [];

    const byThread = new Map<string, typeof messages>();
    for (const message of messages) {
      const bucket = byThread.get(message.threadId) ?? [];
      bucket.push(message);
      byThread.set(message.threadId, bucket);
    }

    return {
      projectId,
      pageId: pageId ?? null,
      threads: threads.map((thread) =>
        toCommentThreadDto(thread, byThread.get(thread.id) ?? []),
      ),
    };
  }

  @Post()
  async create(
    @Param("projectId") projectId: string,
    @Body() body: CreateCommentInput,
  ): Promise<CommentThreadDto> {
    await this.assertProject(projectId);
    const parsed = createCommentSchema.parse(body);
    await this.assertPage(projectId, parsed.pageId);

    const [thread] = await this.db.client
      .insert(commentThreads)
      .values({
        projectId,
        pageId: parsed.pageId,
        nodeId: parsed.nodeId ?? null,
        nodeLabel: parsed.nodeLabel ?? null,
        createdBy: parsed.authorName ?? DEFAULT_COMMENT_AUTHOR,
      })
      .returning();

    const [message] = await this.db.client
      .insert(commentMessages)
      .values({
        threadId: thread.id,
        authorName: parsed.authorName ?? DEFAULT_COMMENT_AUTHOR,
        body: parsed.body,
      })
      .returning();

    return toCommentThreadDto(thread, [message]);
  }

  @Post(":threadId/messages")
  async reply(
    @Param("projectId") projectId: string,
    @Param("threadId") threadId: string,
    @Body() body: ReplyCommentInput,
  ): Promise<CommentThreadDto> {
    const thread = await this.getThread(projectId, threadId);
    const parsed = replyCommentSchema.parse(body);

    await this.db.client.insert(commentMessages).values({
      threadId: thread.id,
      authorName: parsed.authorName ?? DEFAULT_COMMENT_AUTHOR,
      body: parsed.body,
    });
    const [updated] = await this.db.client
      .update(commentThreads)
      .set({ updatedAt: new Date() })
      .where(eq(commentThreads.id, thread.id))
      .returning();

    return this.withMessages(updated);
  }

  @Patch(":threadId")
  async updateStatus(
    @Param("projectId") projectId: string,
    @Param("threadId") threadId: string,
    @Body() body: UpdateCommentThreadInput,
  ): Promise<CommentThreadDto> {
    const thread = await this.getThread(projectId, threadId);
    const parsed = updateCommentThreadSchema.parse(body);
    const [updated] = await this.db.client
      .update(commentThreads)
      .set({ status: parsed.status, updatedAt: new Date() })
      .where(eq(commentThreads.id, thread.id))
      .returning();

    return this.withMessages(updated);
  }

  private async withMessages(
    thread: typeof commentThreads.$inferSelect,
  ): Promise<CommentThreadDto> {
    const messages = await this.db.client
      .select()
      .from(commentMessages)
      .where(eq(commentMessages.threadId, thread.id))
      .orderBy(asc(commentMessages.createdAt));
    return toCommentThreadDto(thread, messages);
  }

  private async getThread(
    projectId: string,
    threadId: string,
  ): Promise<typeof commentThreads.$inferSelect> {
    await this.assertProject(projectId);
    const [thread] = await this.db.client
      .select()
      .from(commentThreads)
      .where(
        and(
          eq(commentThreads.id, threadId),
          eq(commentThreads.projectId, projectId),
        ),
      )
      .limit(1);
    if (!thread) {
      throw new NotFoundException(`Bình luận ${threadId} không tồn tại`);
    }
    return thread;
  }

  private async assertProject(projectId: string): Promise<void> {
    const [project] = await this.db.client
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException(`Dự án ${projectId} không tồn tại`);
  }

  private async assertPage(projectId: string, pageId: string): Promise<void> {
    const [page] = await this.db.client
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
      .limit(1);
    if (!page) throw new NotFoundException(`Trang ${pageId} không tồn tại`);
  }
}
