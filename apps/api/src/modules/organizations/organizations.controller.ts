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
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Request } from "express";
import type {
  AddOrganizationMemberInput,
  OrgMemberDto,
  OrganizationDetailResponse,
  OrganizationDto,
  OrganizationListResponse,
  OrganizationMemberListResponse,
  UpdateOrganizationInput,
  UpdateOrganizationMemberRoleInput,
  CreateOrganizationInput,
  OrganizationMemberRole,
} from "@ai-mockup-studio/shared-types";
import {
  addOrganizationMemberSchema,
  createOrganizationSchema,
  updateOrganizationMemberRoleSchema,
  updateOrganizationSchema,
} from "@ai-mockup-studio/validators";
import { AccessService } from "../../common/access.service";
import { DbService } from "../../db/db.service";
import { organizationMembers, organizations, users } from "../../db/schema";
import { toOrgDto, toOrgMemberDto } from "./organizations.service";

/**
 * Organization workspace (plan/07 4.11). An organization bundles projects and
 * members; the org owner (`organizations.ownerId`) is implicit, admins and
 * members are explicit `organization_members` rows. Roles: owner > admin >
 * member. Only owner/admin manage members; members can read shared projects.
 */
@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(@Req() req: Request): Promise<OrganizationListResponse> {
    const user = await this.access.resolve(req);
    if (!user) return { organizations: [] };
    const orgIds = await this.access.userOrganizationIds(user.id);
    if (orgIds.length === 0) return { organizations: [] };
    const rows = await this.db.client
      .select()
      .from(organizations)
      .where(inArray(organizations.id, orgIds))
      .orderBy(asc(organizations.createdAt));
    return { organizations: rows.map(toOrgDto) };
  }

  @Post()
  async create(
    @Req() req: Request,
    @Body() body: CreateOrganizationInput,
  ): Promise<OrganizationDto> {
    const parsed = createOrganizationSchema.parse(body);
    const user = await this.access.resolve(req);
    if (!user) {
      throw new NotFoundException(
        "Demo user chưa tồn tại — chạy `pnpm db:push && pnpm db:seed`",
      );
    }
    const [row] = await this.db.client
      .insert(organizations)
      .values({ name: parsed.name, ownerId: user.id })
      .returning();
    return toOrgDto(row);
  }

  @Get(":orgId")
  async detail(
    @Req() req: Request,
    @Param("orgId") orgId: string,
  ): Promise<OrganizationDetailResponse> {
    const user = await this.access.resolve(req);
    if (!user) {
      throw new ForbiddenException("Không xác định được danh tính.");
    }
    const role = await this.access.getOrgRole(orgId, user.id);
    if (role === null) {
      throw new NotFoundException(`Tổ chức ${orgId} không tồn tại.`);
    }
    const [org] = await this.db.client
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) throw new NotFoundException(`Tổ chức ${orgId} không tồn tại.`);
    return {
      ...toOrgDto(org),
      myRole: role,
      canManage: role === "owner" || role === "admin",
    };
  }

  @Patch(":orgId")
  async update(
    @Req() req: Request,
    @Param("orgId") orgId: string,
    @Body() body: UpdateOrganizationInput,
  ): Promise<OrganizationDto> {
    await this.access.assertOrgRole(orgId, "admin", req);
    const parsed = updateOrganizationSchema.parse(body);
    const [row] = await this.db.client
      .update(organizations)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning();
    if (!row) throw new NotFoundException(`Tổ chức ${orgId} không tồn tại.`);
    return toOrgDto(row);
  }

  @Delete(":orgId")
  async remove(
    @Req() req: Request,
    @Param("orgId") orgId: string,
  ): Promise<{ removed: string }> {
    await this.access.assertOrgRole(orgId, "owner", req);
    await this.db.client
      .delete(organizations)
      .where(eq(organizations.id, orgId));
    return { removed: orgId };
  }

  @Get(":orgId/members")
  async listMembers(
    @Req() req: Request,
    @Param("orgId") orgId: string,
  ): Promise<OrganizationMemberListResponse> {
    const me = await this.access.assertOrgRole(orgId, "member", req);
    const rows = await this.db.client
      .select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        createdAt: organizationMembers.createdAt,
        userId: organizationMembers.userId,
      })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgId))
      .orderBy(asc(organizationMembers.createdAt));

    const members = new Array<OrgMemberDto>();
    for (const row of rows) {
      const [u] = await this.db.client
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      if (!u) continue;
      members.push(toOrgMemberDto(row, u));
    }

    // The org owner is implicit — surface them with role "owner".
    const [org] = await this.db.client
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (org) {
      const [owner] = await this.db.client
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, org.ownerId))
        .limit(1);
      if (owner) {
        members.unshift({
          id: `owner:${owner.id}`,
          organizationId: orgId,
          user: { id: owner.id, email: owner.email, name: owner.name },
          role: "owner",
          createdAt: new Date(0).toISOString(),
        });
      }
    }

    return {
      organizationId: orgId,
      canManage: me.role === "owner" || me.role === "admin",
      members,
    };
  }

  @Post(":orgId/members")
  async addMember(
    @Req() req: Request,
    @Param("orgId") orgId: string,
    @Body() body: AddOrganizationMemberInput,
  ): Promise<OrgMemberDto> {
    await this.access.assertOrgRole(orgId, "admin", req);
    const parsed = addOrganizationMemberSchema.parse(body);

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

    const [org] = await this.db.client
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (org && org.ownerId === target.id) {
      throw new BadRequestException(
        "Chủ sở hữu là mặc định — không cần thêm vào danh sách member.",
      );
    }

    const existing = await this.db.client
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, target.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new BadRequestException("Người dùng này đã là thành viên của tổ chức.");
    }

    const [row] = await this.db.client
      .insert(organizationMembers)
      .values({
        organizationId: orgId,
        userId: target.id,
        role: parsed.role,
      })
      .returning();

    return toOrgMemberDto(
      {
        id: row.id,
        organizationId: row.organizationId,
        role: row.role as OrganizationMemberRole,
        createdAt: row.createdAt,
      },
      { id: target.id, email: target.email, name: target.name },
    );
  }

  @Patch(":orgId/members/:memberId")
  async updateMemberRole(
    @Req() req: Request,
    @Param("orgId") orgId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateOrganizationMemberRoleInput,
  ): Promise<OrgMemberDto> {
    const me = await this.access.assertOrgRole(orgId, "admin", req);
    const parsed = updateOrganizationMemberRoleSchema.parse(body);

    const [row] = await this.db.client
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.id, memberId),
          eq(organizationMembers.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Thành viên không tồn tại.");

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
      .update(organizationMembers)
      .set({ role: parsed.role })
      .where(eq(organizationMembers.id, memberId))
      .returning();

    return toOrgMemberDto(
      {
        id: updated.id,
        organizationId: updated.organizationId,
        role: updated.role as OrganizationMemberRole,
        createdAt: updated.createdAt,
      },
      { id: target.id, email: target.email, name: target.name },
    );
  }

  @Delete(":orgId/members/:memberId")
  async removeMember(
    @Req() req: Request,
    @Param("orgId") orgId: string,
    @Param("memberId") memberId: string,
  ): Promise<{ removed: string }> {
    const me = await this.access.assertOrgRole(orgId, "admin", req);

    const [row] = await this.db.client
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.id, memberId),
          eq(organizationMembers.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("Thành viên không tồn tại.");

    if (me.role === "admin" && me.id === row.userId) {
      throw new ForbiddenException(
        "Admin không thể tự xóa khỏi tổ chức — hãy nhờ owner hoặc admin khác.",
      );
    }

    await this.db.client
      .delete(organizationMembers)
      .where(eq(organizationMembers.id, memberId));
    return { removed: memberId };
  }
}
