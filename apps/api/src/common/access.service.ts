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
import type { ProjectRole } from "@ai-mockup-studio/shared-types";
import { PROJECT_ROLE_RANK } from "@ai-mockup-studio/shared-types";
import { DbService } from "../db/db.service";
import { projects, projectMembers, users } from "../db/schema";
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
  async resolve(req?: Request): Promise<{ id: string; email: string } | null> {
    const raw = req?.headers?.["x-user-email"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (header === undefined || header === "") {
      return this.findDemo();
    }
    const email = String(header).toLowerCase().trim();
    const [row] = await this.db.client
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
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

    const role = await this.roleForProject(project.ownerId, projectId, user.id);
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
    const [project] = await this.db.client
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) return null;
    return this.roleForProject(project.ownerId, projectId, userId);
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
    ownerId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    if (ownerId === userId) return "owner";
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

  /** Return the demo user or null if it does not exist yet. */
  private async findDemo(): Promise<{ id: string; email: string } | null> {
    const [row] = await this.db.client
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, "demo@mockup.studio"))
      .limit(1);
    return row ?? null;
  }
}
