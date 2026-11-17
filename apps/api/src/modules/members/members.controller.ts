import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type { Request } from "express";
import type {
  AddProjectMemberInput,
  ProjectMemberDto,
  ProjectMemberListResponse,
  ProjectRole,
  UpdateProjectMemberRoleInput,
} from "@ai-mockup-studio/shared-types";
import {
  addProjectMemberSchema,
  updateProjectMemberRoleSchema,
} from "@ai-mockup-studio/validators";
import { AccessService } from "../../common/access.service";
import { DbService } from "../../db/db.service";
import { projectMembers, users } from "../../db/schema";
import { toMemberDto } from "./members.service";

/**
 * Member management for role-based access control (plan/07 4.5). The project
 * owner is implicit (`projects.ownerId`) and never appears as a member row;
 * everyone else with access holds an explicit admin/editor/viewer row.
 * Admin+ can manage members; the owner is always senior to any admin.
 */
@Controller("projects/:projectId/members")
export class MembersController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Param("projectId") projectId: string,
  ): Promise<ProjectMemberListResponse> {
    const me = await this.access.assertProjectRole(projectId, "viewer", req);
    const rows = await this.db.client
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.createdAt));

    const members = new Array<ProjectMemberDto>();
    for (const row of rows) {
      const [user] = await this.db.client
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      if (!user) continue;
      members.push(
        toMemberDto({ ...row, role: row.role as ProjectRole }, user),
      );
    }

    // The owner is implicit — surface them with role "owner" and name/email.
    const owner = await this.access.getOwner(projectId);
    if (owner) {
      members.unshift({
        id: `owner:${owner.id}`,
        projectId,
        user: { id: owner.id, email: owner.email, name: owner.name },
        role: "owner",
        createdAt: new Date(0).toISOString(),
      });
    }

    return {
      projectId,
      canManage:
        me.role === "owner" || me.role === "admin",
      members,
    };
  }

  @Post()
  async add(
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Body() body: AddProjectMemberInput,
  ): Promise<ProjectMemberDto> {
    await this.access.assertProjectRole(projectId, "admin", req);
    const parsed = addProjectMemberSchema.parse(body);

    const [target] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, parsed.email))
      .limit(1);
    if (!target) {
      throw new NotFoundException(
        `Không tìm thấy người dùng với email ${parsed.email}`,
      );
    }

    const owner = await this.access.getOwner(projectId);
    if (owner && owner.id === target.id) {
      throw new BadRequestException(
        "Chủ sở hữu là mặc định — không cần thêm vào danh sách member.",
      );
    }

    const existing = await this.db.client
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, target.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new BadRequestException("Người dùng này đã là member của dự án.");
    }

    const [row] = await this.db.client
      .insert(projectMembers)
      .values({
        projectId,
        userId: target.id,
        role: parsed.role,
      })
      .returning();

    return toMemberDto(
      {
        id: row.id,
        projectId: row.projectId,
        role: row.role as ProjectRole,
        createdAt: row.createdAt,
      },
      { id: target.id, email: target.email, name: target.name },
    );
  }

  @Patch(":memberId")
  async updateRole(
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateProjectMemberRoleInput,
  ): Promise<ProjectMemberDto> {
    const me = await this.access.assertProjectRole(projectId, "admin", req);
    const parsed = updateProjectMemberRoleSchema.parse(body);

    const [row] = await this.db.client
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Member không tồn tại.");

    const [target] = await this.db.client
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!target) throw new NotFoundException("Người dùng không tồn tại.");

    // An admin must not demote/alter another admin (only the owner manages admins).
    if (me.role === "admin" && row.role === "admin" && me.id !== target.id) {
      throw new ForbiddenException(
        "Admin không được thay đổi vai trò của admin khác.",
      );
    }

    const [updated] = await this.db.client
      .update(projectMembers)
      .set({ role: parsed.role })
      .where(eq(projectMembers.id, memberId))
      .returning();

    return toMemberDto(
      {
        id: updated.id,
        projectId: updated.projectId,
        role: updated.role as ProjectRole,
        createdAt: updated.createdAt,
      },
      { id: target.id, email: target.email, name: target.name },
    );
  }

  @Delete(":memberId")
  async remove(
    @Req() req: Request,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ): Promise<{ removed: string }> {
    const me = await this.access.assertProjectRole(projectId, "admin", req);

    const [row] = await this.db.client
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Member không tồn tại.");

    // Users cannot remove themselves at the last admin standing; owner is separate.
    if (me.role === "admin" && me.id === row.userId) {
      throw new ForbiddenException(
        "Admin không thể tự xóa khỏi dự án — hãy nhờ owner hoặc admin khác.",
      );
    }

    await this.db.client
      .delete(projectMembers)
      .where(eq(projectMembers.id, memberId));
    return { removed: memberId };
  }
}
