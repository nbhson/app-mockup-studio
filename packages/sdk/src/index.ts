// Typed TypeScript client for the AI Mockup Studio REST API (plan/07 4.9).
//
// The SDK wraps the same project/document endpoints the web app uses. It is
// framework-agnostic and works in Node (>=18, global fetch) and browsers.
//
// Usage:
//   import { MockupClient } from "@ai-mockup-studio/sdk";
//   const api = new MockupClient({ baseUrl: "http://localhost:3000/api" });
//   const project = await api.createProject({ name: "Landing" });
//   await api.saveDocument(project.id, document);
import type {
  DocumentResponse,
  PageDetailResponse,
  PageListResponse,
  ProjectDto,
  ProjectMemberListResponse,
  UpdateProjectInput,
  VersionListResponse,
} from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";

/** A `fetch`-compatible function (browser global, Node 18+, undici). */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface MockupClientOptions {
  /** Base URL of the API, e.g. `http://localhost:3000/api`. */
  baseUrl: string;
  /** Custom fetch impl (defaults to the global fetch). */
  fetch?: FetchLike;
  /**
   * Identity to send as `x-user-email`. Omit it to act as the demo user. The
   * header is how the API resolves "who am I" in this MVP.
   */
  userEmail?: string;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
}

export class MockupError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "MockupError";
  }
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

/** Encode a value for use as a single URL PATH segment. */
function enc(value: string): string {
  return encodeURIComponent(value);
}

export class MockupClient {
  private readonly fetch: FetchLike;
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(options: MockupClientOptions) {
    if (!options.baseUrl) throw new Error("MockupClient requires `baseUrl`");
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.headers = {
      ...(options.headers ?? {}),
      ...(options.userEmail
        ? { "x-user-email": options.userEmail }
        : {}),
    };
  }

  // -- Projects -------------------------------------------------------------

  listProjects(): Promise<ProjectDto[]> {
    return this.request("GET", "/projects");
  }

  createProject(input: CreateProjectInput): Promise<ProjectDto> {
    return this.request("POST", "/projects", input);
  }

  getProject(projectId: string): Promise<ProjectDto> {
    return this.request("GET", `/projects/${enc(projectId)}`);
  }

  updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    return this.request("POST", `/projects/${enc(projectId)}`, input);
  }

  deleteProject(projectId: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/projects/${enc(projectId)}`);
  }

  duplicateProject(projectId: string): Promise<ProjectDto> {
    return this.request("POST", `/projects/${enc(projectId)}/duplicate`);
  }

  // -- Documents & pages ----------------------------------------------------

  getDocument(projectId: string): Promise<DocumentResponse> {
    return this.request("GET", `/projects/${enc(projectId)}/document`);
  }

  /**
   * Save the active page's document. Pass the `revision` you last read as
   * `baseVersion` to get optimistic-concurrency protection (409 on conflict).
   */
  saveDocument(
    projectId: string,
    document: UiDocument,
    baseVersion?: string,
  ): Promise<DocumentResponse> {
    return this.request("POST", `/projects/${enc(projectId)}/document`, {
      document,
      baseVersion: baseVersion ?? null,
    });
  }

  listPages(projectId: string): Promise<PageListResponse> {
    return this.request("GET", `/projects/${enc(projectId)}/pages`);
  }

  getPage(projectId: string, pageId: string): Promise<PageDetailResponse> {
    return this.request("GET", `/projects/${enc(projectId)}/pages/${enc(pageId)}`);
  }

  savePage(
    projectId: string,
    pageId: string,
    document: UiDocument,
    baseVersion?: string,
  ): Promise<PageDetailResponse> {
    return this.request("POST", `/projects/${enc(projectId)}/pages/${enc(pageId)}`, {
      document,
      baseVersion: baseVersion ?? null,
    });
  }

  // -- History & membership -------------------------------------------------

  listVersions(projectId: string, pageId?: string): Promise<VersionListResponse> {
    const query = pageId ? `?pageId=${encodeURIComponent(pageId)}` : "";
    return this.request("GET", `/projects/${enc(projectId)}/versions${query}`);
  }

  restoreVersion(projectId: string, versionId: string): Promise<DocumentResponse> {
    return this.request(
      "POST",
      `/projects/${enc(projectId)}/versions/${enc(versionId)}/restore`,
    );
  }

  listMembers(projectId: string): Promise<ProjectMemberListResponse> {
    return this.request("GET", `/projects/${enc(projectId)}/members`);
  }

  // -- Internals ------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: { ...this.headers },
    };
    if (body !== undefined) {
      init.headers = { ...init.headers, "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await this.fetch(`${this.base}${path}`, init);
    let payload: unknown = null;
    if (res.status !== 204) {
      const text = await res.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
    }
    if (!res.ok) {
      const message =
        (payload as { message?: string })?.message ??
        `HTTP ${res.status} ${method} ${path}`;
      throw new MockupError(res.status, message, payload);
    }
    return payload as T;
  }
}
