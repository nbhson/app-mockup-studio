// Organization DTO + member mapping helpers (plan/07 4.11).
import type {
  OrgMemberDto,
  OrgRole,
  OrganizationDto,
} from "@ai-mockup-studio/shared-types";
import type { OrgMemberRow, OrganizationRow } from "../../db/schema";

export function toOrgDto(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOrgMemberDto(
  row: Pick<OrgMemberRow, "id" | "organizationId" | "role" | "createdAt">,
  user: { id: string; email: string; name: string | null },
): OrgMemberDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    role: row.role as OrgRole,
    createdAt: row.createdAt.toISOString(),
  };
}

export function orgRoleLabel(role: OrgRole): string {
  const labels: Record<OrgRole, string> = {
    owner: "Chủ sở hữu",
    admin: "Quản trị",
    member: "Thành viên",
  };
  return labels[role];
}
