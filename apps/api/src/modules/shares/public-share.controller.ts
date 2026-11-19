import {
  Controller,
  Get,
  GoneException,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  UnauthorizedException,
} from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import type {
  PublicShareResponse,
  ShareVisibility,
} from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { DbService } from "../../db/db.service";
import { documents, pages, projects, shares } from "../../db/schema";
import { ensureHomePage } from "../pages/pages.service";
import { sharePasswordThrottle, verifySharePassword } from "./shares.service";

/**
 * Public preview endpoint (plan/07 4.7). Deliberately unauthenticated: anyone
 * holding the token can view a public link; private links additionally require
 * the `x-share-password` header. Expired links return 410, unknown/revoked 404.
 */
@Controller("share")
export class PublicShareController {
  constructor(private readonly db: DbService) {}

  @Get(":token")
  async view(
    @Param("token") token: string,
    @Headers("x-share-password") password?: string,
  ): Promise<PublicShareResponse> {
    const [share] = await this.db.client
      .select()
      .from(shares)
      .where(eq(shares.token, token))
      .limit(1);
    if (!share || share.revokedAt) {
      throw new NotFoundException("Link chia sẻ không tồn tại hoặc đã bị thu hồi");
    }
    if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("Link chia sẻ đã hết hạn");
    }
    if (share.visibility === "private") {
      if (!password) {
        throw new UnauthorizedException("Link này cần mật khẩu để xem");
      }
      // Brute-force guard: check the budget before paying the scrypt cost, so
      // a locked-out token never reaches the expensive comparison.
      const budget = sharePasswordThrottle.check(token);
      if (!budget.allowed) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            error: "Too Many Requests",
            message: `Nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ${budget.retryAfterSeconds} giây.`,
            retryAfter: budget.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (
        !share.passwordHash ||
        !(await verifySharePassword(password, share.passwordHash))
      ) {
        sharePasswordThrottle.recordFailure(token);
        throw new UnauthorizedException("Mật khẩu không đúng");
      }
      // Correct password clears the failure window for this token.
      sharePasswordThrottle.reset(token);
    }

    const [project] = await this.db.client
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, share.projectId))
      .limit(1);
    if (!project) throw new NotFoundException("Dự án của link chia sẻ không tồn tại");

    // Legacy projects may still have a document but no page row.
    await ensureHomePage(this.db, share.projectId);

    const rows = await this.db.client
      .select({
        name: pages.name,
        slug: pages.slug,
        schema: documents.schema,
      })
      .from(pages)
      .innerJoin(documents, eq(pages.documentId, documents.id))
      .where(eq(pages.projectId, share.projectId))
      .orderBy(asc(pages.position), asc(pages.createdAt));

    await this.db.client
      .update(shares)
      .set({
        viewCount: sql`${shares.viewCount} + 1`,
        lastViewedAt: new Date(),
      })
      .where(eq(shares.id, share.id));

    return {
      token: share.token,
      projectName: project.name,
      visibility: (share.visibility === "private" ? "private" : "public") as ShareVisibility,
      pages: rows.map((row) => ({
        name: row.name,
        slug: row.slug,
        document: row.schema as unknown as UiDocument,
      })),
      createdAt: share.createdAt.toISOString(),
      expiresAt: share.expiresAt?.toISOString() ?? null,
    };
  }
}
