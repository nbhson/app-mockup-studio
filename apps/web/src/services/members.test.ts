import { describe, expect, it } from "vitest";
import type { ProjectMemberDto } from "@ai-mockup-studio/shared-types";
import { roleBadgeClass, roleLabel } from "./members";

describe("member role helpers", () => {
  it("labels every role in English", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("editor")).toBe("Editor");
    expect(roleLabel("viewer")).toBe("Viewer");
  });

  it("gives each role a distinct badge colour", () => {
    const roles: ProjectMemberDto["role"][] = ["owner", "admin", "editor", "viewer"];
    const classes = roles.map(roleBadgeClass);
    expect(new Set(classes).size).toBe(4);
    for (const cls of classes) expect(cls).toMatch(/bg-\w+-100/);
  });
});
