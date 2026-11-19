import { describe, expect, it, vi } from "vitest";
import { MockupClient, MockupError } from "./index";

const PROJECT = {
  id: "proj-1",
  name: "Landing",
  description: null,
  designSystemId: null,
  ownerId: "user-1",
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const DOC = {
  projectId: "proj-1",
  currentPageId: "page-1",
  document: null,
  updatedAt: "2026-11-18T00:00:00.000Z",
  revision: 0,
};

function stubFetch(response: { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const text = response.body === undefined ? "" : JSON.stringify(response.body);
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetch: fetchImpl };
}

describe("MockupClient", () => {
  it("sends requests to baseUrl with the user email header", async () => {
    const { calls, fetch } = stubFetch({ status: 200, body: [PROJECT] });
    const client = new MockupClient({
      baseUrl: "http://localhost:3000/api/",
      userEmail: "dev@example.com",
      fetch: fetch as never,
    });
    const projects = await client.listProjects();
    expect(projects).toEqual([PROJECT]);
    expect(calls[0].url).toBe("http://localhost:3000/api/projects");
    expect(calls[0].init?.headers).toMatchObject({ "x-user-email": "dev@example.com" });
  });

  it("creates a project with a JSON body", async () => {
    const { calls, fetch } = stubFetch({ status: 201, body: PROJECT });
    const client = new MockupClient({ baseUrl: "http://x/api", fetch: fetch as never });
    const created = await client.createProject({ name: "Landing", description: "hi" });
    expect(created).toEqual(PROJECT);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      name: "Landing",
      description: "hi",
    });
  });

  it("round-trips the optimistic concurrency token on saveDocument", async () => {
    const { calls, fetch } = stubFetch({ status: 201, body: DOC });
    const client = new MockupClient({ baseUrl: "http://x/api", fetch: fetch as never });
    const document = { schemaVersion: "0.1.0", id: "d1" } as never;
    await client.saveDocument("proj-1", document, "3");
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.baseVersion).toBe("3");

    const without = stubFetch({ status: 201, body: DOC });
    await new MockupClient({ baseUrl: "http://x/api", fetch: without.fetch as never }).saveDocument("proj-1", document);
    expect(JSON.parse(String(without.calls[0].init?.body)).baseVersion).toBeNull();
  });

  it("queries versions with the page filter", async () => {
    const { calls, fetch } = stubFetch({ status: 200, body: { versions: [] } });
    const client = new MockupClient({ baseUrl: "http://x/api", fetch: fetch as never });
    await client.listVersions("proj-1", "page-7");
    expect(calls[0].url).toContain("/versions?pageId=page-7");
  });

  it("percent-encodes ids used as URL path segments", async () => {
    const { calls, fetch } = stubFetch({ status: 200, body: { page: null, document: null } });
    const client = new MockupClient({ baseUrl: "http://x/api", fetch: fetch as never });
    // An id containing "/", "?" or spaces must not break out of its segment.
    await client.getPage("proj /1", "page?x=2");
    expect(calls[0].url).toBe("http://x/api/projects/proj%20%2F1/pages/page%3Fx%3D2");

    await client.restoreVersion("a/b", "c?d");
    expect(calls[1].url).toBe("http://x/api/projects/a%2Fb/versions/c%3Fd/restore");
  });

  it("throws MockupError with the server message on non-2xx", async () => {
    const { fetch } = stubFetch({
      status: 409,
      body: { message: "Document đã được người khác cập nhật." },
    });
    const client = new MockupClient({ baseUrl: "http://x/api", fetch: fetch as never });
    const error = await client
      .saveDocument("proj-1", { schemaVersion: "0.1.0" } as never)
      .catch((e) => e);
    expect(error).toBeInstanceOf(MockupError);
    expect((error as MockupError).statusCode).toBe(409);
    expect((error as MockupError).message).toContain("người khác");
  });

  it("rejects a missing baseUrl at construction", () => {
    expect(() => new MockupClient({ baseUrl: "" })).toThrow(/baseUrl/);
  });
});
