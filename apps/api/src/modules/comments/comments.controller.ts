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
  Req,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
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
import { AccessService } from "../../common/access.service";
import {
  commentMessages,
  commentThreads,
  documents,
  pages,
  projects,
} from "../../db/schema";
import { collectIds } from "@ai-mockup-studio/ui-schema";
import { toCommentThreadDto } from "./comments.service";

/**
 * Canvas review comments (plan/07 4.6). Threads live under a project and are
 * scoped to one page; a thread may additionally target a specific node.
 */
@Controller("projects/:projectId/comments")
export class CommentsController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Query("pageId") pageId?: string,
    @Query("status") status?: string,
  ): Promise<CommentListResponse> {
    await this.access.assertProjectRole(projectId, "viewer", req);
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
    @Req() req: Request,
  ): Promise<CommentThreadDto> {
    // Comments live on the project workspace like edits, and their author is
    // shown as trusted attribution ("who flagged this node"). Allowing mere
    // viewers to create threads with an arbitrary `authorName` enabled
    // impersonation, so writes require editor AND the author comes from the
    // verified identity — never from the request body.
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const authorName = user.name || user.email;
    await this.assertProject(projectId);
    const parsed = createCommentSchema.parse(body);
    const page = await this.assertPage(projectId, parsed.pageId);

    // Validate the anchor: a thread pointing at a node that does not exist
    // in the page's document can never be opened from the canvas again.
    if (parsed.nodeId && page.documentId) {
      const [doc] = await this.db.client
        .select({ schema: documents.schema })
        .from(documents)
        .where(eq(documents.id, page.documentId))
        .limit(1);
      const root = (doc?.schema as { root?: { id: string } } | undefined)?.root;
      if (root && !collectIds(root as never).includes(parsed.nodeId)) {
        throw new BadRequestException(
          `Component ${parsed.nodeId} không tồn tại trên trang này`,
        );
      }
    }

    // Thread + first message must land together: a message-less thread
    // breaks every list/resolve path that assumes messages[0] exists.
    const [thread, message] = await this.db.client.transaction(async (tx) => {
      const [created] = await tx
        .insert(commentThreads)
        .values({
          projectId,
          pageId: parsed.pageId,
          nodeId: parsed.nodeId ?? null,
          nodeLabel: parsed.nodeLabel ?? null,
          createdBy: authorName,
        })
        .returning();

      const [first] = await tx
        .insert(commentMessages)
        .values({
          threadId: created.id,
          authorName,
          body: parsed.body,
        })
        .returning();

      return [created, first] as const;
    });

    return toCommentThreadDto(thread, [message]);
  }

  @Post(":threadId/messages")
  async reply(
    @Param("projectId") projectId: string,
    @Param("threadId") threadId: string,
    @Body() body: ReplyCommentInput,
    @Req() req: Request,
  ): Promise<CommentThreadDto> {
    // Same rule as create(): editor, and the author is the verified identity,
    // not whatever `authorName` the client sent.
    const user = await this.access.assertProjectRole(projectId, "editor", req);
    const thread = await this.getThread(projectId, threadId);
    const parsed = replyCommentSchema.parse(body);

    await this.db.client.insert(commentMessages).values({
      threadId: thread.id,
      authorName: user.name || user.email,
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
    @Req() req: Request,
  ): Promise<CommentThreadDto> {
    await this.access.assertProjectRole(projectId, "editor", req);
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

  private async assertPage(
    projectId: string,
    pageId: string,
  ): Promise<{ id: string; documentId: string | null }> {
    const [page] = await this.db.client
      .select({ id: pages.id, documentId: pages.documentId })
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
      .limit(1);
    if (!page) throw new NotFoundException(`Trang ${pageId} không tồn tại`);
    return page;
  }
}
