import { describe, expect, it } from "vitest";
import { PresenceService } from "./presence.service";

const owner = {
  id: "user-owner",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
};
const viewer = {
  id: "user-viewer",
  email: "viewer@example.com",
  name: null,
  role: "viewer" as const,
};

function inbox() {
  const messages: Array<Record<string, unknown>> = [];
  return { messages, send: (data: string) => messages.push(JSON.parse(data)) };
}

describe("presence service", () => {
  it("broadcasts the roster to everyone when a peer joins", () => {
    const presence = new PresenceService();
    const a = inbox();
    const b = inbox();
    presence.join("p1", owner, a.send);
    presence.join("p1", viewer, b.send);

    expect(a.messages.at(-1)).toMatchObject({
      type: "presence",
      projectId: "p1",
      users: [owner, viewer],
    });
    expect(b.messages.at(-1)).toMatchObject({
      type: "presence",
      users: [owner, viewer],
    });
  });

  it("lists a user with two tabs once, keeping the strongest role", () => {
    const presence = new PresenceService();
    presence.join("p1", viewer, () => undefined);
    presence.join("p1", { ...viewer, role: "editor" }, () => undefined);

    expect(presence.connectionCount("p1")).toBe(2);
    expect(presence.users("p1")).toEqual([{ ...viewer, role: "editor" }]);
  });

  it("removes a peer and rebroadcasts on leave", () => {
    const presence = new PresenceService();
    const a = inbox();
    presence.join("p1", owner, a.send);
    const leave = presence.join("p1", viewer, () => undefined);
    leave();

    expect(a.messages.at(-1)).toMatchObject({
      type: "presence",
      users: [owner],
    });
    expect(presence.connectionCount("p1")).toBe(1);
  });

  it("is idempotent when leave is called twice", () => {
    const presence = new PresenceService();
    const leave = presence.join("p1", owner, () => undefined);
    leave();
    leave();
    expect(presence.connectionCount("p1")).toBe(0);
    expect(presence.users("p1")).toEqual([]);
  });

  it("broadcasts document updates with the actor", () => {
    const presence = new PresenceService();
    const a = inbox();
    presence.join("p1", owner, a.send);
    presence.broadcastDocumentUpdate("p1", {
      pageId: "page-1",
      updatedAt: "2026-11-17T10:00:00.000Z",
      actor: { email: "editor@example.com" },
    });

    expect(a.messages.at(-1)).toEqual({
      type: "document:updated",
      projectId: "p1",
      pageId: "page-1",
      updatedAt: "2026-11-17T10:00:00.000Z",
      actor: { email: "editor@example.com" },
    });
  });

  it("keeps broadcasting when one peer's socket throws", () => {
    const presence = new PresenceService();
    const healthy = inbox();
    presence.join("p1", owner, () => {
      throw new Error("socket closed");
    });
    presence.join("p1", viewer, healthy.send);

    expect(() =>
      presence.broadcastDocumentUpdate("p1", {
        pageId: "page-1",
        updatedAt: "2026-11-17T10:00:00.000Z",
        actor: { email: "owner@example.com" },
      }),
    ).not.toThrow();
    expect(healthy.messages.at(-1)).toMatchObject({ type: "document:updated" });
  });

  it("scopes rooms by project", () => {
    const presence = new PresenceService();
    const a = inbox();
    presence.join("p1", owner, a.send);
    presence.broadcastDocumentUpdate("p2", {
      pageId: "other",
      updatedAt: "2026-11-17T10:00:00.000Z",
      actor: { email: "x@example.com" },
    });
    expect(a.messages.some((m) => m.type === "document:updated")).toBe(false);
  });
});
