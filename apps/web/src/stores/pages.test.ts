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

function page(id: string, name: string): PageSummaryDto {
  return {
    id,
    name,
    slug: id,
    position: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("document store pages", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads the page list before the active document", async () => {
    const home = page("page-1", "Home");
    mocks.get.mockImplementation(async (path: string) =>
      path.endsWith("/pages")
        ? { projectId: "p1", currentPageId: home.id, pages: [home] }
        : {
            projectId: "p1",
            currentPageId: home.id,
            document: makeDoc("Home"),
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
    );

    const store = useDocumentStore();
    await store.load("p1");

    expect(mocks.get.mock.calls.map((call) => call[0])).toEqual([
      "/projects/p1/pages",
      "/projects/p1/document",
    ]);
    expect(store.pages).toEqual([home]);
    expect(store.currentPageId).toBe("page-1");
    expect(store.currentPage?.name).toBe("Home");
    expect(store.document?.name).toBe("Home");
    store.$dispose();
  });

  it("flushes dirty edits before switching pages", async () => {
    const about = page("page-2", "About");
    mocks.post.mockImplementation(async (path: string) =>
      path.endsWith("/document")
        ? { projectId: "p1", currentPageId: "page-1", document: makeDoc("Dirty") }
        : {
            projectId: "p1",
            currentPageId: about.id,
            pages: [page("page-1", "Home"), about],
          },
    );
    mocks.get.mockResolvedValue({
      projectId: "p1",
      page: about,
      document: makeDoc("About"),
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [page("page-1", "Home"), about];
    store.currentPageId = "page-1";
    store.setDocument(makeDoc("Dirty"));
    expect(store.isDirty).toBe(true);

    await store.switchPage("page-2");

    expect(mocks.post.mock.calls[0]?.[0]).toBe("/projects/p1/document");
    expect(mocks.post.mock.calls[1]?.[0]).toBe(
      "/projects/p1/pages/page-2/activate",
    );
    expect(store.currentPageId).toBe("page-2");
    expect(store.document?.name).toBe("About");
    expect(store.isDirty).toBe(false);
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
    mocks.get.mockResolvedValue({
      projectId: "p1",
      page: first,
      document: makeDoc("Landing"),
    });

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
    mocks.delete.mockResolvedValue({
      projectId: "p1",
      currentPageId: "page-1",
      pages: [page("page-1", "Home")],
    });

    const store = useDocumentStore();
    store.setProject("p1");
    store.pages = [page("page-1", "Home"), page("page-2", "About")];
    store.currentPageId = "page-1";
    store.setDocument(makeDoc("Home"));

    await store.deletePage("page-2");

    expect(mocks.get).not.toHaveBeenCalled();
    expect(store.currentPageId).toBe("page-1");
    expect(store.document?.name).toBe("Home");
    store.$dispose();
  });
});
