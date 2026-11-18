// Project access service (plan/07 4.5). Provides identity resolution and role
// enforcement for every project-scoped controller.
//
// Identity:
//   The "current user" is resolved from the `x-user-email` HTTP header. When
//   the header is absent the demo user (demo@mockup.studio) is used. A header
//   naming an unknown user resolves to null (403) — it must never fall back to
//   the demo owner.
//
// Role hierarchy (rank): owner(3) > admin(2) > editor(1) > viewer(0)
//
// Usage in a controller:
//   await this.access.assertProjectRole(projectId, "editor", req);
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { OrgRole, ProjectRole } from "@ai-mockup-studio/shared-types";
import { ORG_ROLE_RANK, PROJECT_ROLE_RANK } from "@ai-mockup-studio/shared-types";
import { DbService } from "../db/db.service";
import {
  projects,
  projectMembers,
  users,
  organizations,
  organizationMembers,
} from "../db/schema";
import type { Request } from "express";

@Injectable()
export class AccessService {
  constructor(private readonly db: DbService) {}

  /**
   * Resolve the current user from the `x-user-email` header. When the header is
   * absent the demo user (demo@mockup.studio) is used. A header naming an
   * unknown user resolves to `null` — it must NOT silently fall back to the
   * demo owner, otherwise a typo/unknown identity would gain owner access.
   */
  async resolve(
    req?: Request,
  ): Promise<{ id: string; email: string; name: string | null } | null> {
    const raw = req?.headers?.["x-user-email"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (header === undefined || header === "") {
      return this.findDemo();
    }
    return this.resolveEmail(String(header));
  }

  /**
   * Resolve an explicit email address to a user. Used by the presence gateway,
   * which cannot send HTTP headers (browsers can't set them on a WebSocket).
   * An unknown email resolves to `null`; never falls back to the demo owner.
   */
  async resolveEmail(
    email: string,
  ): Promise<{ id: string; email: string; name: string | null } | null> {
    const normalized = email.toLowerCase().trim();
    if (!normalized) return null;
    const [row] = await this.db.client
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    return row ?? null;
  }

  /**
   * Assert the current user has at least `minRole` on the project.
   * - 403 when the identity is unknown or not a member
   * - 403 when the member's role is below the requirement
   * - 404 when the project itself does not exist
   */
  async assertProjectRole(
    projectId: string,
    minRole: ProjectRole,
    req?: Request,
  ): Promise<{ id: string; email: string; role: ProjectRole }> {
    const user = await this.resolve(req);
    if (!user) throw new ForbiddenException("Không xác định được người dùng");

    const [project] = await this.db.client
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      throw new NotFoundException(`Dự án ${projectId} không tồn tại`);
    }

    const role = await this.getProjectRole(projectId, user.id);
    if (role === null) {
      throw new ForbiddenException("Bạn không có quyền truy cập dự án này");
    }
    const minRank = PROJECT_ROLE_RANK[minRole];
    const actualRank = PROJECT_ROLE_RANK[role];
    if (actualRank < minRank) {
      throw new ForbiddenException(
        `Cần quyền ${minRole} trở lên — bạn hiện là ${role}`,
      );
    }
    return { ...user, role };
  }

  /**
   * Return the effective project role for a given user.
   * `owner` is never stored in project_members — it comes from projects.ownerId.
   * Returns `null` when the user has no access (or the project is missing).
   */
  async getProjectRole(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    // 1. Direct ownership + explicit project membership.
    const direct = await this.roleForProject(projectId, userId);
    if (direct) return direct;

    // 2. Organization workspace fallback (plan/07 4.11).
    //    Look up the project's org and check org membership.
    const [project] = await this.db.client
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project?.organizationId) return null;

    const [orgMember] = await this.db.client
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, project.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!orgMember) return null;

    const [org] = await this.db.client
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId))
      .limit(1);
    if (!org) return null;
    if (org.ownerId === userId) return "editor";
    return orgMember.role === "admin" ? "editor" : "viewer";
  }

  /**
   * Organizations the user belongs to (owns or is an explicit member of) —
   * used to surface org projects in the project list.
   */
  async userOrganizationIds(userId: string): Promise<string[]> {
    const [owned, memberRows] = await Promise.all([
      this.db.client
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.ownerId, userId)),
      this.db.client
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, userId)),
    ]);
    const orgIds = new Set(memberRows.map((r) => r.organizationId));
    for (const org of owned) orgIds.add(org.id);
    return [...orgIds];
  }

  /** True if the user can perform an action requiring `minRole`. */
  async can(
    projectId: string,
    userId: string,
    minRole: ProjectRole,
  ): Promise<boolean> {
    const role = await this.getProjectRole(projectId, userId);
    if (role === null) return false;
    return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[minRole];
  }

  /**
   * Return the project owner row (name included) or null when the project
   * does not exist.
   */
  async getOwner(projectId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
  } | null> {
    const [row] = await this.db.client
      .select({ id: users.id, email: users.email, name: users.name })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(eq(projects.id, projectId))
      .limit(1);
    return row ?? null;
  }

  /** Resolve a user's role from the owner id plus the member row. */
  private async roleForProject(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    const [project] = await this.db.client
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return null;
    if (project.ownerId === userId) return "owner";
    const [member] = await this.db.client
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .limit(1);
    return member ? (member.role as ProjectRole) : null;
  }

  /**
   * Organization role for a user (plan/07 4.11): the org owner is implicit via
   * `organizations.ownerId`; admins/members are explicit rows. Returns null
   * when the user has no relationship with the org (or the org is missing).
   */
  async getOrgRole(
    orgId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    const [org] = await this.db.client
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) return null;
    if (org.ownerId === userId) return "owner";
    const [member] = await this.db.client
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    return member ? (member.role as OrgRole) : null;
  }

  /**
   * Resolve the requesting identity and require `minRole` on the organization.
   * Throws 401/403/404 for missing/unknown/no-access cases, returns the user.
   */
  async assertOrgRole(
    orgId: string,
    minRole: OrgRole,
    req: Request,
  ): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: OrgRole;
  }> {
    const user = await this.resolve(req);
    if (!user) {
      throw new ForbiddenException(
        "Không xác định được danh tính — yêu cầu header x-user-email hợp lệ.",
      );
    }
    const role = await this.getOrgRole(orgId, user.id);
    if (role === null) {
      throw new NotFoundException(`Tổ chức ${orgId} không tồn tại.`);
    }
    const min = ORG_ROLE_RANK[minRole];
    if (ORG_ROLE_RANK[role] < min) {
      throw new ForbiddenException(
        `Quyền ${minRole} trở lên được yêu cầu — hiện tại bạn là ${role}.`,
      );
    }
    return { ...user, role };
  }

  /** Return the demo user or null if it does not exist yet. */
  private async findDemo(): Promise<{
    id: string;
    email: string;
    name: string | null;
  } | null> {
    const [row] = await this.db.client
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, "demo@mockup.studio"))
      .limit(1);
    return row ?? null;
  }
}
