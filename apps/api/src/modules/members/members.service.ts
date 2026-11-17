// Member mapping helpers for role-based access control (plan/07 4.5).
import type { ProjectMemberDto, ProjectRole } from "@ai-mockup-studio/shared-types";
import type { ProjectMemberRow } from "../../db/schema";

export function toMemberDto(
  row: Pick<ProjectMemberRow, "id" | "projectId" | "role" | "createdAt">,
  user: { id: string; email: string; name: string | null },
): ProjectMemberDto {
  return {
    id: row.id,
    projectId: row.projectId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    role: row.role as ProjectRole,
    createdAt: row.createdAt.toISOString(),
  };
}
