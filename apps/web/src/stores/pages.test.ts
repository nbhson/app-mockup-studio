import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import type { PageSummaryDto } from "@ai-mockup-studio/shared-types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../services/api", () => ({ api: mocks }));

import { useDocumentStore } from "./document";

const ISO = "2026-01-01T00:00:00.000Z";

function makeDoc(name: string): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: `doc-${name}`,
    pageId: `page-${name}`,
    name,
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#ffffff",
      background: "#ffffff",
      foreground: "#0F172A",
      muted: "#F1F5F9",
      mutedForeground: "#64748B",
      border: "#E2E8F0",
      fontFamily: "Inter, sans-serif",
      radius: 8,
    },
    root: { id: "root", type: "layout.container", children: [] },
  };
}

function page(id: string, name: string, updatedAt = ISO): PageSummaryDto {
  return {
    id,
    name,
    slug: id,
    position: 0,
    updatedAt,
  };
}

/** Page-scoped `POST/GET /projects/:p/pages/:id` response shape. */
function pageDetail(p: PageSummaryDto, doc: UiDocument, revision: number) {
  return {
    projectId: "p1",
    page: p,
    document: doc,
    updatedAt: p.updatedAt,
    revision,
  };
}

describe("document store pages", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Neutral defaults so a test that does not configure an endpoint never
    // inherits the previous test's implementation (mock implementations are
    // NOT cleared by clearAllMocks).
    mocks.get.mockResolvedValue({
      projectId: "p1",
      currentPageId: null,
      page: page("page-1", "Home"),
      pages: [],
      document: null,
      updatedAt: ISO,
      revision: 1,
    });
    mocks.post.mockResolvedValue({
      projectId: "p1",
      currentPageId: "",
      document: null,
      updatedAt: ISO,
      revision: 1,
    });
    mocks.put.mockResolvedValue({
      projectId: "p1",
      currentPageId: null,
      pages: [],
    });
    mocks.patch.mockResolvedValue({
      projectId: "p1",
      page: page("page-1", "Home"),
      document: makeDoc("Home"),
      updatedAt: ISO,
      revision: 1,
    });
    mocks.delete.mockResolvedValue({
      projectId: "p1",
      currentPageId: null,
      pages: [],
    });
  });

  it("loads the page list before the active document", async () => {
    const home = page("page-1", "Home");
    mocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/pages")) {
        return { projectId: "p1", currentPageId: home.id, pages: [home] };
      }
      if (path === "/projects/p1") {
        return {
          id: "p1",
          name: "Project",
          description: null,
          designSystemId: "ds-1",
          createdAt: ISO,
          updatedAt: ISO,
        };
      }
      return {
        projectId: "p1",
        currentPageId: home.id,
        document: makeDoc("Home"),
        updatedAt: ISO,
      };
    });

    const store = useDocumentStore();
    await store.load("p1");

    expect(mocks.get.mock.calls.map((call) => call[0])).toEqual([
      "/projects/p1/pages",
      "/projects/p1/document",
      "/projects/p1",
    ]);
    expect(store.pages).toEqual([home]);
    expect(store.currentPageId).toBe("page-1");
    expect(store.currentPage?.name).toBe("Home");
    expect(store.document?.name).toBe("Home");
    expect(store.designSystemId).toBe("ds-1");
    store.$dispose();
  });

  it("flushes dirty edits to the page being left before switching", async () => {
    const home = page("page-1", "Home");
    const about = page("page-2", "About");
    mocks.post.mockImplementation(async (path: string, body?: { document?: UiDocument }) => {
      if (path === "/projects/p1/pages/page-1") {
        // Page-scoped flush: the edits land on the page the client opened,
        // regardless of which page the project marks active.
        return pageDetail(
          home,
          body?.document ?? makeDoc("Dirty"),
          4,
        );
      }
      return {
        projectId: "p1",
        currentPageId: about.id,
        pages: [home, about],
      };
    });
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/projects/p1/pages/page-2") {
        return pageDetail(about, makeDoc("About"), 2);
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [home, about];
    store.currentPageId = "page-1";
    store.setDocument(makeDoc("Dirty"));
    expect(store.isDirty).toBe(true);

    await store.switchPage("page-2");

    expect(mocks.post.mock.calls[0]?.[0]).toBe("/projects/p1/pages/page-1");
    expect(mocks.post.mock.calls[0]?.[1]).toMatchObject({ baseVersion: null });
    expect(mocks.post.mock.calls[1]?.[0]).toBe(
      "/projects/p1/pages/page-2/activate",
    );
    expect(store.currentPageId).toBe("page-2");
    expect(store.document?.name).toBe("About");
    expect(store.isDirty).toBe(false);
    store.$dispose();
  });

  it("saves the page the client is viewing, not the project-wide active page", async () => {
    const home = page("page-1", "Home");
    const about = page("page-2", "About");
    mocks.post.mockImplementation(async (path: string, body?: { document?: UiDocument }) => {
      if (path === "/projects/p1/pages/page-2") {
        return pageDetail(
          { ...about, updatedAt: "2026-01-01T00:05:00.000Z" },
          body?.document ?? makeDoc("About edits"),
          7,
        );
      }
      // Another tab activated page-1 project-wide; the legacy endpoint that
      // resolves "the active page" must never be hit from this tab.
      throw new Error(`unexpected POST ${path}`);
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [home, about];
    store.currentPageId = "page-2";
    store.baseVersion = "6";
    store.setDocument(makeDoc("About edits"));

    await store.save();

    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      "/projects/p1/pages/page-2",
      { document: store.document, baseVersion: "6" },
    );
    expect(store.baseVersion).toBe("7");
    expect(store.isDirty).toBe(false);
    expect(store.saveError).toBeNull();
    // The page row in the switcher reflects the new document timestamp.
    expect(store.pages.find((p) => p.id === "page-2")?.updatedAt).toBe(
      "2026-01-01T00:05:00.000Z",
    );
    store.$dispose();
  });

  it("keeps the legacy project endpoint for a brand-new project without pages", async () => {
    const home = page("page-1", "Home");
    mocks.post.mockResolvedValue({
      projectId: "p1",
      currentPageId: home.id,
      document: makeDoc("Home"),
      updatedAt: ISO,
      revision: 1,
    });
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/projects/p1/pages") {
        return { projectId: "p1", currentPageId: home.id, pages: [home] };
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.setDocument(makeDoc("Home"));
    expect(store.currentPageId).toBeNull();

    await store.save();

    expect(mocks.post).toHaveBeenCalledWith(
      "/projects/p1/document",
      { document: store.document, baseVersion: null },
    );
    // The first save created the home page server-side; the client adopts it.
    expect(store.currentPageId).toBe("page-1");
    expect(store.pages).toEqual([home]);
    expect(store.baseVersion).toBe("1");
    expect(store.isDirty).toBe(false);
    store.$dispose();
  });

  it("reloadLatest refreshes the open page without jumping to the active one", async () => {
    const home = page("page-1", "Home");
    const about = page("page-2", "About");
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/projects/p1/pages/page-2") {
        return pageDetail(
          { ...about, updatedAt: "2026-01-01T00:10:00.000Z" },
          makeDoc("About v9"),
          9,
        );
      }
      // The project-level document endpoint would resolve to page-1 (the
      // active page another tab flipped) — reloading must stay page-scoped.
      throw new Error(`unexpected GET ${path}`);
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [home, about];
    store.currentPageId = "page-2";
    store.setDocument(makeDoc("Local edits"));
    store.saveConflict = true;
    store.saveError = "Document đã được người khác cập nhật.";

    await store.reloadLatest();

    expect(store.document?.name).toBe("About v9");
    expect(store.currentPageId).toBe("page-2");
    expect(store.baseVersion).toBe("9");
    expect(store.saveConflict).toBe(false);
    expect(store.saveError).toBeNull();
    expect(store.isDirty).toBe(false);
    expect(store.loadError).toBeNull();
    store.$dispose();
  });

  it("rebases the design-system refresh on the open page", async () => {
    const home = page("page-1", "Home");
    const about = page("page-2", "About");
    const appliedTheme = { ...makeDoc("Home").theme, primary: "#10B981" };
    mocks.post.mockImplementation(async (path: string, body?: { document?: UiDocument }) => {
      if (path === "/projects/p1/design-system") {
        return {
          projectId: "p1",
          designSystemId: "ds-9",
          theme: appliedTheme,
          updatedPages: 2,
        };
      }
      if (path === "/projects/p1/pages/page-2") {
        return pageDetail(about, body?.document ?? makeDoc("About"), 4);
      }
      throw new Error(`unexpected POST ${path}`);
    });
    mocks.get.mockImplementation(async (path: string) => {
      if (path === "/projects/p1/pages/page-2") {
        // Server bumped every page's revision: this page is now at 8.
        return pageDetail(about, makeDoc("About"), 8);
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [home, about];
    store.currentPageId = "page-2";
    store.setDocument(makeDoc("About"));

    await store.applyDesignSystem("ds-9");

    expect(mocks.get).toHaveBeenCalledWith("/projects/p1/pages/page-2");
    expect(
      mocks.get.mock.calls.map((call) => call[0]),
    ).not.toContain("/projects/p1/document");
    expect(store.designSystemId).toBe("ds-9");
    expect(store.document?.theme).toEqual(appliedTheme);
    expect(store.baseVersion).toBe("8");
    expect(store.isDirty).toBe(false);
    store.$dispose();
  });

  it("drops replacePages results when the project switched mid-request", async () => {
    const landing = page("page-a", "Landing");
    const store = useDocumentStore();
    mocks.put.mockImplementation(async () => {
      // The user opened another project while the bulk replace was in flight.
      store.setProject("p2");
      store.pages = [page("page-z", "Other")];
      store.currentPageId = "page-z";
      return { projectId: "p1", currentPageId: landing.id, pages: [landing] };
    });
    mocks.get.mockImplementation(async (path: string) => {
      throw new Error(`must not fetch replaced pages after navigation (${path})`);
    });

    store.setProject("p1");
    store.pages = [page("page-1", "Home")];
    store.currentPageId = "page-1";
    store.setDocument(makeDoc("P1 home"));

    const list = await store.replacePages({
      pages: [{ name: "Landing", slug: "landing", document: makeDoc("Landing") }],
    });

    // The server outcome is still reported to the dialog …
    expect(list.pages).toHaveLength(1);
    // … but none of it leaked into the project now open on screen.
    expect(store.currentPageId).toBe("page-z");
    expect(store.pages).toEqual([page("page-z", "Other")]);
    expect(store.document?.name).toBe("P1 home");
    store.$dispose();
  });

  it("replaces every page and opens the first generated page", async () => {
    const first = page("page-a", "Landing");
    const second = page("page-b", "Pricing");
    mocks.put.mockResolvedValue({
      projectId: "p1",
      currentPageId: first.id,
      pages: [first, second],
    });
    mocks.get.mockResolvedValue(pageDetail(first, makeDoc("Landing"), 1));

    const store = useDocumentStore();
    store.setProject("p1");
    store.setDocument(makeDoc("Old"));
    const result = await store.replacePages({
      pages: [
        { name: "Landing", slug: "landing", document: makeDoc("Landing") },
        { name: "Pricing", slug: "pricing", document: makeDoc("Pricing") },
      ],
    });

    expect(mocks.put).toHaveBeenCalledWith("/projects/p1/pages", {
      pages: [
        { name: "Landing", slug: "landing", document: makeDoc("Landing") },
        { name: "Pricing", slug: "pricing", document: makeDoc("Pricing") },
      ],
    });
    expect(result?.pages).toHaveLength(2);
    expect(store.pages).toHaveLength(2);
    expect(store.currentPageId).toBe("page-a");
    expect(store.document?.name).toBe("Landing");
    expect(store.isDirty).toBe(false);
    store.$dispose();
  });

  it("deleting a background page keeps the current document", async () => {
    const home = page("page-1", "Home");
    mocks.delete.mockResolvedValue({
      projectId: "p1",
      currentPageId: home.id,
      pages: [home],
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [home, page("page-2", "About")];
    store.currentPageId = "page-1";
    store.setDocument(makeDoc("Home"));

    await store.deletePage("page-2");

    expect(mocks.get).not.toHaveBeenCalled();
    expect(store.currentPageId).toBe("page-1");
    expect(store.document?.name).toBe("Home");
    store.$dispose();
  });

  it("re-arms the autosave when deleting a background page with dirty edits", async () => {
    vi.useFakeTimers();
    try {
      const home = page("page-1", "Home");
      const about = page("page-2", "About");
      mocks.delete.mockResolvedValue({
        projectId: "p1",
        currentPageId: home.id,
        pages: [home],
      });
      mocks.post.mockImplementation(async (path: string, body?: { document?: UiDocument }) => {
        if (path === "/projects/p1/pages/page-1") {
          return pageDetail(home, body?.document ?? makeDoc("Home"), 3);
        }
        throw new Error(`unexpected POST ${path}`);
      });

      const store = useDocumentStore();
      store.setProject("p1");
      store.pages = [home, about];
      store.currentPageId = "page-1";
      store.setDocument(makeDoc("Home edits"));
      expect(store.isDirty).toBe(true);

      await store.deletePage("page-2");
      expect(store.isDirty).toBe(true); // delete itself does not save anything

      await vi.advanceTimersByTimeAsync(1500);

      // The pending autosave was re-armed (not silently cancelled) and still
      // targets the open page through the page-scoped endpoint.
      expect(mocks.post).toHaveBeenCalledWith(
        "/projects/p1/pages/page-1",
        expect.objectContaining({ document: expect.anything() }),
      );
      expect(store.isDirty).toBe(false);
      store.$dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces load failures through loadError instead of swallowing them", async () => {
    mocks.get.mockRejectedValue(new Error("Network error"));

    const store = useDocumentStore();
    await expect(store.load("p1")).rejects.toThrow("Network error");

    expect(store.loadError).toBe("Network error");
    expect(store.isLoading).toBe(false);
    // A failed load must not adopt the new project id over the old state.
    expect(store.projectId).toBeNull();
    store.$dispose();
  });

  it("ignores a stale load response when the route changed mid-flight", async () => {
    const home1 = page("page-1", "Home 1");
    const home2 = page("page-2", "Home 2");
    let staleReleased = false;
    const pendingStale: Array<() => void> = [];

    const stalePayload = (path: string) => {
      if (path.endsWith("/pages")) {
        return { projectId: "p1", currentPageId: home1.id, pages: [home1] };
      }
      if (path.endsWith("/document")) {
        return {
          currentPageId: home1.id,
          document: makeDoc("P1"),
          updatedAt: ISO,
          revision: 1,
        };
      }
      return {
        id: "p1",
        name: "P1",
        description: null,
        designSystemId: null,
        createdAt: ISO,
        updatedAt: ISO,
      };
    };
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith("/projects/p1")) {
        if (staleReleased) return Promise.resolve(stalePayload(path));
        // p1 hangs until the newer p2 route has fully committed.
        return new Promise((resolve) => {
          pendingStale.push(() => resolve(stalePayload(path)));
        });
      }
      if (path === "/projects/p2/pages") {
        return Promise.resolve({
          projectId: "p2",
          currentPageId: home2.id,
          pages: [home2],
        });
      }
      if (path === "/projects/p2/document") {
        return Promise.resolve({
          currentPageId: home2.id,
          document: makeDoc("P2"),
          updatedAt: ISO,
          revision: 5,
        });
      }
      return Promise.resolve({
        id: "p2",
        name: "P2",
        description: null,
        designSystemId: null,
        createdAt: ISO,
        updatedAt: ISO,
      });
    });

    const store = useDocumentStore();
    const staleLoad = store.load("p1");
    await store.load("p2"); // newer route commits first

    staleReleased = true;
    pendingStale.splice(0).forEach((release) => release());
    await staleLoad;

    // The late p1 response must not overwrite anything the p2 load committed.
    expect(store.projectId).toBe("p2");
    expect(store.document?.name).toBe("P2");
    expect(store.pages.map((p) => p.name)).toEqual(["Home 2"]);
    expect(store.baseVersion).toBe("5");
    expect(store.loadError).toBeNull();
    store.$dispose();
  });

  it("flushes edits then applies a design system theme to the open page", async () => {
    const appliedTheme = { ...makeDoc("Home").theme, primary: "#10B981" };
    mocks.post.mockImplementation(async (path: string, body?: { document?: unknown }) => {
      if (path.endsWith("/design-system")) {
        return {
          projectId: "p1",
          designSystemId: "ds-9",
          theme: appliedTheme,
          updatedPages: 2,
        };
      }
      return {
        projectId: "p1",
        currentPageId: "page-1",
        document: body?.document,
        updatedAt: ISO,
      };
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.setDocument(makeDoc("Home"));
    expect(store.isDirty).toBe(true);

    await store.applyDesignSystem("ds-9");

    // No page is open yet on this fresh store, so the legacy project
    // endpoints are the correct target (it creates the home page).
    expect(mocks.post.mock.calls.map((call) => call[0])).toEqual([
      "/projects/p1/document",
      "/projects/p1/design-system",
    ]);
    expect(store.designSystemId).toBe("ds-9");
    expect(store.document?.theme).toEqual(appliedTheme);
    expect(store.document?.name).toBe("Home");
    expect(store.isDirty).toBe(false);
    store.$dispose();
  });

  it("clears the design system link when detaching", async () => {
    mocks.post.mockResolvedValue({
      projectId: "p1",
      designSystemId: null,
      theme: null,
      updatedPages: 0,
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.designSystemId = "ds-9";
    store.setDocument(makeDoc("Home"));
    store.isDirty = false;
    const theme = store.document?.theme;

    await store.applyDesignSystem(null);

    expect(mocks.post).toHaveBeenCalledWith("/projects/p1/design-system", {
      designSystemId: null,
    });
    expect(store.designSystemId).toBeNull();
    expect(store.document?.theme).toBe(theme);
    store.$dispose();
  });
});
