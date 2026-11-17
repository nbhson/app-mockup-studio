import { describe, expect, it } from "vitest";
import { toMemberDto } from "./members.service";

describe("members service", () => {
  const row = {
    id: "member-1",
    projectId: "project-1",
    role: "editor" as const,
    createdAt: new Date("2026-11-17T10:00:00Z"),
  };
  const user = { id: "user-1", email: "an@example.com", name: "An" };

  it("maps a member row to a DTO with nested user identity", () => {
    const dto = toMemberDto(row, user);
    expect(dto).toEqual({
      id: "member-1",
      projectId: "project-1",
      user: { id: "user-1", email: "an@example.com", name: "An" },
      role: "editor",
      createdAt: "2026-11-17T10:00:00.000Z",
    });
  });

  it("preserves each role verbatim", () => {
    for (const role of ["admin", "editor", "viewer"] as const) {
      expect(toMemberDto({ ...row, role }, user).role).toBe(role);
    }
  });

  it("keeps a null display name", () => {
    const dto = toMemberDto(row, { ...user, name: null });
    expect(dto.user.name).toBeNull();
  });

  it("does not expose the internal user id in place of the member id", () => {
    const dto = toMemberDto(row, user);
    expect(dto.id).toBe("member-1");
    expect(dto.user.id).toBe("user-1");
  });
});
