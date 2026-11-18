import { describe, expect, it } from "vitest";
import { orgRoleLabel, toOrgDto, toOrgMemberDto } from "./organizations.service";

describe("organizations service", () => {
  const org = {
    id: "org-1",
    name: "Studio Team",
    ownerId: "user-1",
    createdAt: new Date("2026-11-18T09:00:00Z"),
    updatedAt: new Date("2026-11-18T09:00:00Z"),
  };
  const memberRow = {
    id: "om-1",
    organizationId: "org-1",
    role: "member" as const,
    createdAt: new Date("2026-11-18T09:05:00Z"),
  };
  const user = { id: "user-2", email: "bin@example.com", name: "Bin" };

  it("maps an organization row to a DTO with ISO timestamps", () => {
    const dto = toOrgDto(org);
    expect(dto).toEqual({
      id: "org-1",
      name: "Studio Team",
      ownerId: "user-1",
      createdAt: "2026-11-18T09:00:00.000Z",
      updatedAt: "2026-11-18T09:00:00.000Z",
    });
  });

  it("maps a member row to a nested DTO and preserves its role", () => {
    const dto = toOrgMemberDto(memberRow, user);
    expect(dto).toEqual({
      id: "om-1",
      organizationId: "org-1",
      user: { id: "user-2", email: "bin@example.com", name: "Bin" },
      role: "member",
      createdAt: "2026-11-18T09:05:00.000Z",
    });
  });

  it("maps every org role to a Vietnamese label", () => {
    expect(orgRoleLabel("owner")).toBe("Chủ sở hữu");
    expect(orgRoleLabel("admin")).toBe("Quản trị");
    expect(orgRoleLabel("member")).toBe("Thành viên");
  });

  it("keeps a null member display name", () => {
    const dto = toOrgMemberDto(memberRow, { ...user, name: null });
    expect(dto.user.name).toBeNull();
  });
});
