// Client helpers for project membership and roles (plan/07 4.5).
import type {
  AddProjectMemberInput,
  ProjectMemberDto,
  ProjectMemberListResponse,
  UpdateProjectMemberRoleInput,
} from "@ai-mockup-studio/shared-types";
import { api } from "./api";

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberListResponse> {
  return api.get<ProjectMemberListResponse>(`/projects/${projectId}/members`);
}

export async function addProjectMember(
  projectId: string,
  input: AddProjectMemberInput,
): Promise<ProjectMemberDto> {
  return api.post<ProjectMemberDto>(`/projects/${projectId}/members`, input);
}

export async function updateProjectMemberRole(
  projectId: string,
  memberId: string,
  input: UpdateProjectMemberRoleInput,
): Promise<ProjectMemberDto> {
  return api.patch<ProjectMemberDto>(
    `/projects/${projectId}/members/${memberId}`,
    input,
  );
}

export async function removeProjectMember(
  projectId: string,
  memberId: string,
): Promise<{ removed: string }> {
  return api.delete<{ removed: string }>(
    `/projects/${projectId}/members/${memberId}`,
  );
}

/** Human label for a role badge. */
export function roleLabel(role: ProjectMemberDto["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "editor":
      return "Editor";
    default:
      return "Viewer";
  }
}

/** Tailwind classes for the role badge. */
export function roleBadgeClass(role: ProjectMemberDto["role"]): string {
  switch (role) {
    case "owner":
      return "bg-violet-100 text-violet-700";
    case "admin":
      return "bg-blue-100 text-blue-700";
    case "editor":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}
