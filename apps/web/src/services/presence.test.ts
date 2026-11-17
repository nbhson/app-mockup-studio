import { describe, expect, it } from "vitest";
import {
  avatarClass,
  initials,
  parsePresenceMessage,
  presenceLabel,
  presenceUrl,
} from "./presence";

describe("presence helpers", () => {
  it("builds a ws URL with the project and optional identity", () => {
    const location = { protocol: "http:", host: "localhost:5173" };
    expect(presenceUrl("p1", null, location)).toBe(
      "ws://localhost:5173/api/ws/presence?projectId=p1",
    );
    expect(presenceUrl("p1", "an@example.com", location)).toBe(
      "ws://localhost:5173/api/ws/presence?projectId=p1&email=an%40example.com",
    );
  });

  it("uses wss behind https", () => {
    expect(
      presenceUrl("p1", null, { protocol: "https:", host: "app.example.com" }),
    ).toBe("wss://app.example.com/api/ws/presence?projectId=p1");
  });

  it("derives two-letter initials from names and emails", () => {
    expect(initials("Nguyễn Văn An")).toBe("NA");
    expect(initials("an@example.com")).toBe("AN");
    expect(initials("an")).toBe("AN");
    expect(initials("   ")).toBe("?");
  });

  it("gives a user a stable avatar colour", () => {
    expect(avatarClass("an@example.com")).toBe(avatarClass("an@example.com"));
    expect(avatarClass("an@example.com")).toMatch(/^bg-/);
  });

  it("parses presence frames and ignores garbage", () => {
    expect(
      parsePresenceMessage('{"type":"presence","projectId":"p1","users":[]}'),
    ).toMatchObject({ type: "presence", projectId: "p1" });
    expect(parsePresenceMessage("not json")).toBeNull();
    expect(parsePresenceMessage('{"users":[]}')).toBeNull();
  });

  it("labels the roster", () => {
    expect(presenceLabel(false, [])).toBe("Ngoại tuyến");
    expect(presenceLabel(true, [])).toBe("Chỉ bạn");
    expect(
      presenceLabel(true, [
        { id: "1", email: "a@x.com", name: null, role: "owner" },
        { id: "2", email: "b@x.com", name: null, role: "viewer" },
      ]),
    ).toBe("2 online");
  });
});
