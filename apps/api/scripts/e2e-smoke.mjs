#!/usr/bin/env node
// ---------------------------------------------------------------------------
// API E2E smoke test (plan/12 GĐ 6.5 / CI).
//
// Exercises the full HTTP surface against a running API + seeded Postgres:
// projects CRUD/duplicate, documents save/load, version history + reversible
// restore, cross-project isolation, public/private share links (password,
// expiry, revoke), canvas comment threads (element anchors, replies, resolve,
// status filters, cross-project isolation), custom design systems (token CRUD,
// apply/switch/cascade delete), component libraries (CRUD, add/update/remove
// component, export/import bundle, unique name/type), role-based access control
// (owner/admin/editor/viewer enforcement, member management, 403 for viewers
// and non-members), team collaboration (WebSocket presence, optimistic
// concurrency 409, document-update broadcasts), API SDK (create/list/read/save
// via the typed client, 409 through MockupError), assets validation/raw bytes/delete
// and asset copying on duplicate, hidden/locked flags, AI generate/edit and
// observability counters.
//
// Usage: API_URL=http://localhost:3000/api pnpm --filter @ai-mockup-studio/api e2e:api
// Requires the demo user from `pnpm db:seed` (CI seeds before starting the API).
// ---------------------------------------------------------------------------

import "dotenv/config";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import { knownComponentTypes } from "@ai-mockup-studio/ui-schema";
import { Client } from "pg";
import WebSocket from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const API_URL = (process.env.API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
const ORIGIN = new URL(API_URL).origin;
// The suite mirrors the API's own environment (apps/api/.env). With a real
// OPENAI_API_KEY the LLM-backed endpoints answer with source "ai" and only
// fall back to "heuristic" when the provider errors, so the offline-source
// assertions must adapt instead of failing a healthy live-AI setup.
const REAL_LLM = Boolean(process.env.OPENAI_API_KEY);
const AI_SOURCES = new Set(["ai", "heuristic", "mock"]);
const localAnalyzerOk = (source) =>
  REAL_LLM ? AI_SOURCES.has(source) : source === "heuristic";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const checks = [];
let fixtureServer = null;

function check(name, condition, details = "") {
  if (!condition) throw new Error(`FAIL: ${name}${details ? ` — ${details}` : ""}`);
  checks.push(name);
  console.log(`  ✓ ${name}`);
}

function makeDoc(name) {
  return {
    schemaVersion: "0.1.0",
    id: "e2e-doc",
    pageId: "e2e-page",
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
    root: {
      id: "root",
      type: "layout.container",
      children: [{ id: "title", type: "basic.text", props: { text: name } }],
    },
  };
}

async function request(method, path, options = {}) {
  const { body, status, headers } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (status !== undefined) {
    if (res.status !== status) {
      throw new Error(`${method} ${path} expected ${status}, got ${res.status}: ${text.slice(0, 300)}`);
    }
  } else if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return { status: res.status, payload, headers: res.headers };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Move a share's expiry into the past so the 410 path can be exercised. */
async function expireShareNow(token) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "UPDATE shares SET expires_at = now() - interval '1 minute' WHERE token = $1",
      [token],
    );
  } finally {
    await client.end();
  }
}

/** Open a presence WebSocket and buffer every server frame it receives. */
function connectPresence(projectId, email) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ projectId });
    if (email) query.set("email", email);
    const ws = new WebSocket(
      `${API_URL.replace(/^http/, "ws")}/ws/presence?${query.toString()}`,
    );
    ws.received = [];
    ws.closeCode = null;
    ws.on("message", (data) => {
      try {
        ws.received.push(JSON.parse(String(data)));
      } catch {
        // ignore malformed frames
      }
    });
    ws.on("close", (code) => {
      ws.closeCode = code;
    });
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(ws);
    };
    ws.once("open", settle);
    // Rejected identities may be closed before the open event is observed.
    ws.once("close", settle);
    ws.once("error", reject);
  });
}

/** Poll buffered frames for one matching a predicate. */
function waitForMessage(ws, predicate, label, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = ws.received.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 25);
  });
}

/** Resolve with the close code (waiting for a close that may have happened). */
function waitForClose(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      resolve(ws.closeCode);
    };
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for WebSocket close")),
      timeout,
    );
    if (ws.closeCode !== null) {
      done();
      return;
    }
    ws.once("close", done);
    // A close can land between the check above and the listener registration.
    if (ws.closeCode !== null) done();
  });
}

async function main() {
  console.log(`API E2E smoke — ${API_URL}`);
console.log(
  REAL_LLM
    ? "  AI provider: real LLM configured (offline-source assertions relaxed)"
    : "  AI provider: mock/heuristic (offline mode)",
);
  let sdkProject = null;

  // Local fixture page for URL-to-UI. The API allows this exact host:port via
  // URL_TO_UI_ALLOWED_HOSTS in CI; every other private address stays blocked.
  fixtureServer = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head>
    <title>Acme Landing</title>
    <meta name="description" content="A fixture page for URL-to-UI" />
  </head>
  <body>
    <nav><a href="/features">Features</a><a href="/pricing">Pricing</a></nav>
    <h1>Build faster</h1>
    <p>Ship your next idea with confidence.</p>
    <h2>Features</h2>
    <p>Everything you need to launch.</p>
    <h2>Pricing</h2>
    <p>Simple plans for every team.</p>
    <img src="/hero.png" alt="hero" />
    <button>Get started</button>
  </body>
</html>`);
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(3199, "127.0.0.1", resolve);
  });

  // --- Readiness -----------------------------------------------------------
  let health = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await request("GET", "/health");
      health = res.payload;
      if (health.status === "ok") break;
    } catch {
      // retry while the API starts
    }
    if (attempt === 59) throw new Error("API not reachable");
    await sleep(500);
  }
  check("health is ok", health?.status === "ok", JSON.stringify(health));
  check("health reports database up", health?.checks?.database === "up");

  // --- Projects ------------------------------------------------------------
  const suffix = Date.now().toString(36);
  const project = (
    await request("POST", "/projects", {
      body: { name: `API E2E ${suffix}`, description: "smoke test" },
    })
  ).payload;
  const isolation = (
    await request("POST", "/projects", { body: { name: `API E2E Isolation ${suffix}` } })
  ).payload;
  check("create project", Boolean(project.id) && project.name.startsWith("API E2E"));
  check("created project is listed", (await request("GET", "/projects")).payload.some((p) => p.id === project.id));

  const renamed = (
    await request("POST", `/projects/${project.id}`, {
      body: { name: `API E2E Renamed ${suffix}` },
    })
  ).payload;
  check("rename project", renamed.name === `API E2E Renamed ${suffix}`);

  // --- Documents + version history ----------------------------------------
  const docV1 = makeDoc("E2E v1");
  const saveV1 = (
    await request("POST", `/projects/${project.id}/document`, { body: { document: docV1 } })
  ).payload;
  check("save document v1", saveV1.document?.name === "E2E v1");
  check(
    "load document v1",
    (await request("GET", `/projects/${project.id}/document`)).payload.document?.name === "E2E v1",
  );

  const docV2 = makeDoc("E2E v2");
  await request("POST", `/projects/${project.id}/document`, { body: { document: docV2 } });
  const versions = (await request("GET", `/projects/${project.id}/versions`)).payload.versions;
  check("autosave created a version snapshot", versions.length >= 1, `versions=${versions.length}`);

  const v1 = versions[0];
  const detail = (await request("GET", `/projects/${project.id}/versions/${v1.id}`)).payload;
  check("version detail contains the previous document", detail.document?.name === "E2E v1");

  const restored = (
    await request("POST", `/projects/${project.id}/versions/${v1.id}/restore`)
  ).payload;
  check("restore version", restored.document?.name === "E2E v1");

  const versionsAfterRestore = (
    await request("GET", `/projects/${project.id}/versions`)
  ).payload.versions;
  check(
    "restore snapshots the pre-restore state",
    versionsAfterRestore.length > versions.length,
    `${versions.length} -> ${versionsAfterRestore.length}`,
  );
  const reversible = (
    await request("POST", `/projects/${project.id}/versions/${versionsAfterRestore[0].id}/restore`)
  ).payload;
  check("restore is reversible (back to v2)", reversible.document?.name === "E2E v2");

  // --- Cross-project isolation --------------------------------------------
  await request("GET", `/projects/${isolation.id}/versions/${v1.id}`, { status: 404 });
  check("version from another project is not accessible", true);

  // --- Multi-page (plan/07 3.4) -------------------------------------------
  await request("POST", `/projects/${isolation.id}/document`, {
    body: { document: makeDoc("Isolation home") },
  });
  const homePages = (await request("GET", `/projects/${isolation.id}/pages`)).payload;
  check(
    "pages list wraps the project in a home page",
    homePages.pages.length === 1 && homePages.currentPageId === homePages.pages[0].id,
    JSON.stringify(homePages),
  );
  const homePage = homePages.pages[0];

  const about = (
    await request("POST", `/projects/${isolation.id}/pages`, {
      body: { name: "Giới thiệu", document: makeDoc("About page") },
    })
  ).payload;
  check(
    "create page with its own document",
    about.page.slug === "gioi-thieu" && about.document?.name === "About page",
    JSON.stringify(about.page),
  );
  check(
    "page detail returns the page document",
    (await request("GET", `/projects/${isolation.id}/pages/${about.page.id}`)).payload.document
      ?.name === "About page",
  );

  const activated = (
    await request("POST", `/projects/${isolation.id}/pages/${about.page.id}/activate`)
  ).payload;
  check("activate page", activated.currentPageId === about.page.id);
  check(
    "active page drives the legacy document endpoint",
    (await request("GET", `/projects/${isolation.id}/document`)).payload.document?.name ===
      "About page",
  );

  await request("POST", `/projects/${isolation.id}/pages/${about.page.id}`, {
    body: { document: makeDoc("About v2") },
  });
  const pageVersions = (
    await request("GET", `/projects/${isolation.id}/versions?pageId=${about.page.id}`)
  ).payload.versions;
  const homeVersions = (
    await request("GET", `/projects/${isolation.id}/versions?pageId=${homePage.id}`)
  ).payload.versions;
  check("page save snapshots the previous document", pageVersions.length >= 1);
  check(
    "version history filters by page",
    pageVersions.every((entry) => !homeVersions.some((other) => other.id === entry.id)),
    JSON.stringify({ pageVersions, homeVersions }),
  );
  const pageVersionDetail = (
    await request("GET", `/projects/${isolation.id}/versions/${pageVersions[0].id}`)
  ).payload;
  check(
    "page version detail contains that page's snapshot",
    pageVersionDetail.document?.name === "About page",
  );

  const renamedPage = (
    await request("PATCH", `/projects/${isolation.id}/pages/${about.page.id}`, {
      body: { name: "Thông tin" },
    })
  ).payload;
  check(
    "rename page updates its slug",
    renamedPage.page.name === "Thông tin" && renamedPage.page.slug === "thong-tin",
    JSON.stringify(renamedPage.page),
  );
  const sameName = (
    await request("POST", `/projects/${isolation.id}/pages`, {
      body: { name: "Thông tin", document: makeDoc("Duplicate name") },
    })
  ).payload;
  check(
    "page slugs are unique inside a project",
    sameName.page.slug === "thong-tin-2",
    sameName.page.slug,
  );

  const multi = (
    await request("POST", "/ai/multi-page", {
      body: {
        prompt: "Landing page cho sản phẩm SaaS quản lý dự án",
        pageCount: 3,
      },
    })
  ).payload;
  check("AI multi-page works offline", localAnalyzerOk(multi.source));
  check(
    "AI multi-page returns linked, valid pages",
    multi.pages.length === 3 &&
      new Set(multi.pages.map((page) => page.slug)).size === 3 &&
      multi.pages.every((page) => uiDocumentSchema.safeParse(page.document).success),
  );
  check(
    "AI multi-page shares one theme across pages",
    multi.pages.every(
      (page) => JSON.stringify(page.document.theme) === JSON.stringify(multi.theme),
    ),
  );

  const replaced = (
    await request("PUT", `/projects/${isolation.id}/pages`, {
      body: { pages: multi.pages },
    })
  ).payload;
  check(
    "replace pages atomically",
    replaced.pages.length === 3 && replaced.currentPageId === replaced.pages[0].id,
    JSON.stringify(replaced),
  );
  check(
    "replace switches the active document",
    (await request("GET", `/projects/${isolation.id}/document`)).payload.document?.name ===
      multi.pages[0].name,
  );

  const afterDelete = (
    await request("DELETE", `/projects/${isolation.id}/pages/${replaced.pages[1].id}`)
  ).payload;
  check(
    "delete page keeps the active page",
    afterDelete.pages.length === 2 && afterDelete.currentPageId === replaced.currentPageId,
    JSON.stringify(afterDelete),
  );

  const pageCopy = (await request("POST", `/projects/${isolation.id}/duplicate`)).payload;
  const copiedPages = (await request("GET", `/projects/${pageCopy.id}/pages`)).payload;
  check(
    "duplicate copies all pages",
    copiedPages.pages.length === 2 &&
      copiedPages.pages.map((page) => page.name).join(",") ===
        afterDelete.pages.map((page) => page.name).join(","),
    JSON.stringify(copiedPages),
  );
  const copiedPageDetail = (
    await request("GET", `/projects/${pageCopy.id}/pages/${copiedPages.pages[1].id}`)
  ).payload;
  check(
    "copied pages keep their own documents",
    copiedPageDetail.document?.name === copiedPages.pages[1].name,
  );

  const beforeLast = (
    await request("DELETE", `/projects/${isolation.id}/pages/${afterDelete.pages[1].id}`)
  ).payload;
  check("delete page down to one", beforeLast.pages.length === 1);
  await request("DELETE", `/projects/${isolation.id}/pages/${beforeLast.pages[0].id}`, {
    status: 400,
  });
  check("cannot delete the last page", true);

  // --- Public/private shares (plan/07 4.7) --------------------------------
  const emptyShares = (await request("GET", `/projects/${project.id}/shares`)).payload;
  check("share list starts empty", emptyShares.shares.length === 0);

  const privateNoPassword = await request("POST", `/projects/${isolation.id}/shares`, {
    body: { visibility: "private" },
    status: 400,
  });
  check("private share requires a password", privateNoPassword.status === 400);

  const publicShare = (
    await request("POST", `/projects/${isolation.id}/shares`, {
      body: { visibility: "public", expiresInDays: 7 },
    })
  ).payload;
  check(
    "create public share",
    publicShare.visibility === "public" &&
      publicShare.hasPassword === false &&
      typeof publicShare.token === "string" &&
      publicShare.token.length >= 20 &&
      publicShare.path === `/share/${publicShare.token}` &&
      typeof publicShare.expiresAt === "string",
    JSON.stringify(publicShare),
  );

  const shared = (await request("GET", `/share/${publicShare.token}`)).payload;
  check(
    "public share resolves without auth",
    shared.projectName === isolation.name &&
      shared.visibility === "public" &&
      shared.pages.length === 1 &&
      uiDocumentSchema.safeParse(shared.pages[0].document).success,
    JSON.stringify({ projectName: shared.projectName, pages: shared.pages?.length }),
  );

  const sharedAgain = (await request("GET", `/share/${publicShare.token}`)).payload;
  const listedShare = (await request("GET", `/projects/${isolation.id}/shares`)).payload.shares.find(
    (entry) => entry.id === publicShare.id,
  );
  check(
    "public share records views",
    sharedAgain.token === publicShare.token && listedShare?.viewCount >= 2,
    JSON.stringify(listedShare),
  );

  const privateShare = (
    await request("POST", `/projects/${isolation.id}/shares`, {
      body: { visibility: "private", password: "mat-khau-e2e" },
    })
  ).payload;
  check(
    "create private share",
    privateShare.visibility === "private" && privateShare.hasPassword === true,
    JSON.stringify(privateShare),
  );

  const locked = await request("GET", `/share/${privateShare.token}`, { status: 401 });
  check(
    "private share asks for a password",
    /mật khẩu/i.test(String(locked.payload?.message ?? "")),
    String(locked.payload?.message ?? ""),
  );

  const wrongPassword = await request("GET", `/share/${privateShare.token}`, {
    status: 401,
    headers: { "x-share-password": "sai-mat-khau" },
  });
  check(
    "private share rejects the wrong password",
    /không đúng/i.test(String(wrongPassword.payload?.message ?? "")),
    String(wrongPassword.payload?.message ?? ""),
  );

  const unlocked = (
    await request("GET", `/share/${privateShare.token}`, {
      headers: { "x-share-password": "mat-khau-e2e" },
    })
  ).payload;
  check(
    "private share opens with the right password",
    unlocked.visibility === "private" &&
      unlocked.pages.length === 1 &&
      uiDocumentSchema.safeParse(unlocked.pages[0].document).success,
  );

  const expiryShare = (
    await request("POST", `/projects/${isolation.id}/shares`, {
      body: { visibility: "public" },
    })
  ).payload;
  if (process.env.DATABASE_URL) {
    await expireShareNow(expiryShare.token);
    const expired = await request("GET", `/share/${expiryShare.token}`, { status: 410 });
    check("expired share returns 410", expired.status === 410);
  } else {
    console.log("  - skip expired share check (DATABASE_URL not set)");
  }

  const revoked = (
    await request("DELETE", `/projects/${isolation.id}/shares/${privateShare.id}`)
  ).payload;
  check(
    "revoke removes the link from the list",
    !revoked.shares.some((entry) => entry.id === privateShare.id),
  );
  await request("GET", `/share/${privateShare.token}`, { status: 404 });
  check("revoked share stops resolving", true);

  const crossProjectRevoke = await request(
    "DELETE",
    `/projects/${project.id}/shares/${publicShare.id}`,
    { status: 404 },
  );
  check("cannot revoke another project's share", crossProjectRevoke.status === 404);

  const otherList = (await request("GET", `/projects/${project.id}/shares`)).payload;
  check("share list is project-scoped", otherList.shares.length === 0);

  const badExpiry = await request("POST", `/projects/${isolation.id}/shares`, {
    body: { visibility: "public", expiresInDays: 0 },
    status: 400,
  });
  check("share expiry is validated", badExpiry.status === 400);

  // --- Comments (plan/07 4.6) ---------------------------------------------
  const commentPages = (await request("GET", `/projects/${isolation.id}/pages`)).payload;
  const commentPage = commentPages.pages[0];
  // Anchors are now validated against the page document (a thread pointing
  // at a node that does not exist can never be opened from the canvas), so
  // the fixture must target a real node of this page's document.
  const commentPageDoc = (
    await request("GET", `/projects/${isolation.id}/pages/${commentPage.id}`)
  ).payload.document;
  let anchorId = null;
  (function walk(node) {
    if (anchorId) return;
    if (node.id !== commentPageDoc.root.id) {
      anchorId = node.id;
      return;
    }
    (node.children ?? []).forEach(walk);
  })(commentPageDoc.root);
  const emptyComments = (
    await request(
      "GET",
      `/projects/${isolation.id}/comments?pageId=${commentPage.id}`,
    )
  ).payload;
  check("comment list starts empty", emptyComments.threads.length === 0);

  const createdComment = (
    await request("POST", `/projects/${isolation.id}/comments`, {
      body: {
        pageId: commentPage.id,
        nodeId: anchorId,
        nodeLabel: "Tiêu đề",
        body: "Đổi tiêu đề này rõ hơn",
        authorName: "Reviewer E2E",
      },
    })
  ).payload;
  check(
    "create element comment thread",
    createdComment.pageId === commentPage.id &&
      createdComment.nodeId === anchorId &&
      createdComment.nodeLabel === "Tiêu đề" &&
      createdComment.status === "open" &&
      createdComment.createdBy === "Reviewer E2E" &&
      createdComment.messages.length === 1 &&
      createdComment.messages[0].body === "Đổi tiêu đề này rõ hơn",
    JSON.stringify(createdComment),
  );

  const listedComments = (
    await request(
      "GET",
      `/projects/${isolation.id}/comments?pageId=${commentPage.id}`,
    )
  ).payload;
  check(
    "comment thread is listed for the page",
    listedComments.pageId === commentPage.id &&
      listedComments.threads.some((thread) => thread.id === createdComment.id),
    JSON.stringify(listedComments.threads?.map((thread) => thread.id)),
  );

  const repliedComment = (
    await request("POST", `/projects/${isolation.id}/comments/${createdComment.id}/messages`, {
      body: { body: "Đã sửa ở bản mới", authorName: "Designer E2E" },
    })
  ).payload;
  check(
    "reply appends to the same thread",
    repliedComment.id === createdComment.id &&
      repliedComment.messages.length === 2 &&
      repliedComment.messages[1].authorName === "Designer E2E" &&
      repliedComment.messages[1].body === "Đã sửa ở bản mới",
    JSON.stringify(repliedComment.messages),
  );

  const resolvedComment = (
    await request("PATCH", `/projects/${isolation.id}/comments/${createdComment.id}`, {
      body: { status: "resolved" },
    })
  ).payload;
  check(
    "resolve marks the thread as done",
    resolvedComment.status === "resolved" && resolvedComment.messages.length === 2,
    JSON.stringify(resolvedComment),
  );

  const openComments = (
    await request(
      "GET",
      `/projects/${isolation.id}/comments?pageId=${commentPage.id}&status=open`,
    )
  ).payload;
  const resolvedComments = (
    await request(
      "GET",
      `/projects/${isolation.id}/comments?pageId=${commentPage.id}&status=resolved`,
    )
  ).payload;
  check(
    "status filter separates open and resolved threads",
    !openComments.threads.some((thread) => thread.id === createdComment.id) &&
      resolvedComments.threads.some((thread) => thread.id === createdComment.id),
  );

  const pageComment = (
    await request("POST", `/projects/${isolation.id}/comments`, {
      body: { pageId: commentPage.id, body: "Nhìn chung ổn" },
    })
  ).payload;
  check(
    "page-level comment has no node anchor",
    pageComment.nodeId === null && pageComment.nodeLabel === null,
    JSON.stringify(pageComment),
  );

  const badComment = await request("POST", `/projects/${isolation.id}/comments`, {
    body: { pageId: commentPage.id, body: "   " },
    status: 400,
  });
  check("empty comment body is rejected", badComment.status === 400);

  const deadAnchor = await request("POST", `/projects/${isolation.id}/comments`, {
    body: { pageId: commentPage.id, nodeId: "no-such-node", body: "Neo chết" },
    status: 400,
  });
  check("comment anchored to a missing node is rejected", deadAnchor.status === 400);

  const crossProjectComment = await request(
    "POST",
    `/projects/${project.id}/comments`,
    { body: { pageId: commentPage.id, body: "Sai dự án" }, status: 404 },
  );
  check("comment page must belong to the project", crossProjectComment.status === 404);

  const crossProjectReply = await request(
    "POST",
    `/projects/${project.id}/comments/${createdComment.id}/messages`,
    { body: { body: "Sai dự án" }, status: 404 },
  );
  check("cannot reply to another project's thread", crossProjectReply.status === 404);

  // --- Design systems (plan/07 4.8) ---------------------------------------
  const dsProject = (
    await request("POST", "/projects", {
      body: { name: `API E2E Design ${suffix}` },
    })
  ).payload;
  await request("POST", `/projects/${dsProject.id}/document`, {
    body: { document: makeDoc("DS home") },
  });
  await request("POST", `/projects/${dsProject.id}/pages`, {
    body: { name: "Thứ hai", document: makeDoc("DS second") },
  });
  const dsPages = (await request("GET", `/projects/${dsProject.id}/pages`)).payload;
  check("design system fixture has two pages", dsPages.pages.length === 2);

  const designSystemA = (
    await request("POST", "/design-systems", {
      body: {
        name: `Brand Blue ${suffix}`,
        description: "Design system cho dashboard",
        theme: {
          mode: "light",
          primary: "#2563EB",
          primaryForeground: "#FFFFFF",
          background: "#FFFFFF",
          foreground: "#0F172A",
          muted: "#F1F5F9",
          mutedForeground: "#64748B",
          border: "#E2E8F0",
          fontFamily: "Be Vietnam Pro",
          radius: 12,
        },
      },
    })
  ).payload;
  check(
    "create design system",
    designSystemA.theme.primary === "#2563EB" &&
      designSystemA.theme.radius === 12 &&
      designSystemA.description === "Design system cho dashboard",
    JSON.stringify(designSystemA),
  );

  const duplicateSystemName = await request("POST", "/design-systems", {
    body: { name: designSystemA.name, theme: designSystemA.theme },
    status: 400,
  });
  check("design system names are unique", duplicateSystemName.status === 400);

  const invalidSystem = await request("POST", "/design-systems", {
    body: { name: `Bad ${suffix}`, theme: { ...designSystemA.theme, mode: "neon" } },
    status: 400,
  });
  check("design system theme is validated", invalidSystem.status === 400);

  const systemList = (await request("GET", "/design-systems")).payload;
  check(
    "design system list includes the new system",
    systemList.designSystems.some((entry) => entry.id === designSystemA.id),
  );

  const appliedA = (
    await request("POST", `/projects/${dsProject.id}/design-system`, {
      body: { designSystemId: designSystemA.id },
    })
  ).payload;
  check(
    "apply design system to all pages",
    appliedA.designSystemId === designSystemA.id && appliedA.updatedPages === 2,
    JSON.stringify(appliedA),
  );

  const appliedPageDocs = [];
  for (const page of dsPages.pages) {
    appliedPageDocs.push(
      (await request("GET", `/projects/${dsProject.id}/pages/${page.id}`)).payload.document,
    );
  }
  check(
    "every page document adopts the design system theme",
    appliedPageDocs.every(
      (document) =>
        document?.theme?.primary === "#2563EB" &&
        document?.theme?.fontFamily === "Be Vietnam Pro" &&
        document?.root?.children?.[0]?.id === "title",
    ),
    JSON.stringify(appliedPageDocs.map((document) => document?.theme?.primary)),
  );

  const appliedProject = (await request("GET", `/projects/${dsProject.id}`)).payload;
  check(
    "project records the active design system",
    appliedProject.designSystemId === designSystemA.id,
  );

  const renamedSystem = (
    await request("PATCH", `/design-systems/${designSystemA.id}`, {
      body: { name: `Renamed Blue ${suffix}`, theme: { ...designSystemA.theme, radius: 16 } },
    })
  ).payload;
  check(
    "update design system tokens",
    renamedSystem.name === `Renamed Blue ${suffix}` && renamedSystem.theme.radius === 16,
  );

  const designSystemB = (
    await request("POST", "/design-systems", {
      body: {
        name: `Emerald Dark ${suffix}`,
        theme: {
          mode: "dark",
          primary: "#10B981",
          primaryForeground: "#052E16",
          background: "#0F172A",
          foreground: "#F8FAFC",
          muted: "#1E293B",
          mutedForeground: "#94A3B8",
          border: "#334155",
          fontFamily: "Inter",
          radius: 4,
        },
      },
    })
  ).payload;
  const appliedB = (
    await request("POST", `/projects/${dsProject.id}/design-system`, {
      body: { designSystemId: designSystemB.id },
    })
  ).payload;
  const switchedDoc = (
    await request("GET", `/projects/${dsProject.id}/pages/${dsPages.pages[0].id}`)
  ).payload.document;
  check(
    "switching projects between design systems rewrites every page",
    appliedB.designSystemId === designSystemB.id &&
      appliedB.updatedPages === 2 &&
      switchedDoc.theme.primary === "#10B981" &&
      switchedDoc.theme.mode === "dark",
    JSON.stringify(switchedDoc.theme),
  );

  const dsCopy = (await request("POST", `/projects/${dsProject.id}/duplicate`)).payload;
  check("duplicate keeps the design system link", dsCopy.designSystemId === designSystemB.id);
  const copiedTheme = (await request("GET", `/projects/${dsCopy.id}/document`)).payload.document
    .theme;
  check(
    "duplicated document keeps the applied tokens",
    copiedTheme.primary === "#10B981",
    JSON.stringify(copiedTheme),
  );

  const detached = (
    await request("POST", `/projects/${dsProject.id}/design-system`, {
      body: { designSystemId: null },
    })
  ).payload;
  const detachedProject = (await request("GET", `/projects/${dsProject.id}`)).payload;
  const detachedDoc = (
    await request("GET", `/projects/${dsProject.id}/pages/${dsPages.pages[0].id}`)
  ).payload.document;
  check(
    "detaching a design system leaves document themes intact",
    detached.designSystemId === null &&
      detached.updatedPages === 0 &&
      detachedProject.designSystemId === null &&
      detachedDoc.theme.primary === "#10B981",
  );

  await request("POST", `/projects/${project.id}/design-system`, {
    body: { designSystemId: "missing-system" },
    status: 404,
  });
  check("cannot apply a missing design system", true);

  await request("POST", "/projects/missing-project/design-system", {
    body: { designSystemId: designSystemB.id },
    status: 404,
  });
  check("cannot apply a design system to a missing project", true);

  const designSystemC = (
    await request("POST", "/design-systems", {
      body: {
        name: `Temporary ${suffix}`,
        theme: { ...designSystemA.theme, radius: 20 },
      },
    })
  ).payload;
  await request("POST", `/projects/${dsProject.id}/design-system`, {
    body: { designSystemId: designSystemC.id },
  });
  const afterDeleteSystems = (
    await request("DELETE", `/design-systems/${designSystemC.id}`)
  ).payload;
  const projectAfterSystemDelete = (await request("GET", `/projects/${dsProject.id}`)).payload;
  check(
    "deleting a design system detaches referencing projects",
    !afterDeleteSystems.designSystems.some((entry) => entry.id === designSystemC.id) &&
      projectAfterSystemDelete.designSystemId === null,
  );

  await request("DELETE", `/design-systems/${designSystemA.id}`);
  await request("DELETE", `/design-systems/${designSystemB.id}`);

  // --- Component libraries (plan/07 4.3) -----------------------------------
  const libraryA = (
    await request("POST", "/component-libraries", {
      body: { name: `SaaS Kit ${suffix}`, description: "Thư viện chung cho SaaS" },
    })
  ).payload;
  check(
    "create component library",
    libraryA.name === `SaaS Kit ${suffix}` &&
      libraryA.description === "Thư viện chung cho SaaS" &&
      libraryA.components.length === 0,
    JSON.stringify(libraryA),
  );

  const duplicateLibrary = await request("POST", "/component-libraries", {
    body: { name: libraryA.name, description: "trùng" },
    status: 400,
  });
  check("component library names are unique", duplicateLibrary.status === 400);

  const badLibrary = await request("POST", "/component-libraries", {
    body: { name: "   " },
    status: 400,
  });
  check("component library name is required", badLibrary.status === 400);

  const navbarSchema = {
    id: "navbar-main",
    type: "layout.navbar",
    props: { title: "SaaS", showBack: false },
    children: [
      { id: "nav-link", type: "basic.button", props: { label: "Pricing" } },
    ],
  };
  const addedComponent = (
    await request("POST", `/component-libraries/${libraryA.id}/components`, {
      body: {
        type: "layout.navbar",
        label: "Navbar",
        category: "navigation",
        schema: navbarSchema,
        tags: ["nav", "header"],
      },
    })
  ).payload;
  check(
    "add a component to the library",
    addedComponent.type === "layout.navbar" &&
      addedComponent.label === "Navbar" &&
      addedComponent.libraryId === libraryA.id,
    JSON.stringify(addedComponent),
  );

  const duplicateComponent = await request(
    "POST",
    `/component-libraries/${libraryA.id}/components`,
    {
      body: { type: "layout.navbar", label: "Navbar 2", schema: navbarSchema },
      status: 400,
    },
  );
  check("component types are unique within a library", duplicateComponent.status === 400);

  const invalidSchema = await request(
    "POST",
    `/component-libraries/${libraryA.id}/components`,
    {
      body: { type: "basic.text", label: "Broken", schema: { type: "basic.text" } },
      status: 400,
    },
  );
  check("component schema is validated", invalidSchema.status === 400);

  const listedLibraries = (
    await request("GET", "/component-libraries")
  ).payload;
  const libraryARow = listedLibraries.libraries.find((l) => l.id === libraryA.id);
  check(
    "component library list includes the new library with its component",
    !!libraryARow && libraryARow.components.length === 1,
    JSON.stringify(libraryARow),
  );

  const libraryDetail = (
    await request("GET", `/component-libraries/${libraryA.id}`)
  ).payload;
  check(
    "library detail returns the stored schema verbatim",
    libraryDetail.components[0]?.id === addedComponent.id &&
      libraryDetail.components[0]?.schema.props.title === "SaaS",
    JSON.stringify(libraryDetail),
  );

  const renamedComponent = (
    await request(
      "PATCH",
      `/component-libraries/${libraryA.id}/components/${addedComponent.id}`,
      { body: { label: "Top navbar", tags: ["nav", "top"] } },
    )
  ).payload;
  check(
    "update component metadata",
    renamedComponent.label === "Top navbar" &&
      renamedComponent.tags.join(",") === "nav,top" &&
      renamedComponent.schema.id === "navbar-main",
  );

  const renamedLibrary = (
    await request("PATCH", `/component-libraries/${libraryA.id}`, {
      body: { name: `SaaS Pro Kit ${suffix}`, description: "Mô tả mới" },
    })
  ).payload;
  check(
    "update library metadata",
    renamedLibrary.name === `SaaS Pro Kit ${suffix}` &&
      renamedLibrary.description === "Mô tả mới" &&
      renamedLibrary.components.length === 1,
    JSON.stringify(renamedLibrary),
  );

  // Renaming onto another existing library's name must be rejected (the check
  // ignores the library that already owns the name).
  const renameCollision = (
    await request("POST", "/component-libraries", {
      body: { name: `Other Kit ${suffix}` },
    })
  ).payload;
  const duplicateRename = await request(
    "PATCH",
    `/component-libraries/${libraryA.id}`,
    { body: { name: `Other Kit ${suffix}` }, status: 400 },
  );
  check("cannot rename a library to an existing name", duplicateRename.status === 400);
  await request("DELETE", `/component-libraries/${renameCollision.id}`);

  const exportPayload = (
    await request("GET", `/component-libraries/${libraryA.id}/export`)
  ).payload;
  check(
    "export library as a portable JSON bundle",
    exportPayload.kind === "ai-mockup-studio/component-library" &&
      exportPayload.components.length === 1 &&
      exportPayload.components[0].schema.type === "layout.navbar",
    JSON.stringify(exportPayload),
  );

  // Free the name so the same bundle can be imported back into a fresh library.
  await request("DELETE", `/component-libraries/${libraryA.id}`);

  const importedLibrary = (
    await request("POST", "/component-libraries/import", { body: exportPayload })
  ).payload;
  check(
    "import a library from an exported bundle",
    importedLibrary.name === `SaaS Pro Kit ${suffix}` &&
      importedLibrary.components.length === 1 &&
      importedLibrary.components[0].label === "Top navbar",
    JSON.stringify(importedLibrary),
  );

  const duplicateImport = await request("POST", "/component-libraries/import", {
    body: exportPayload,
    status: 400,
  });
  check("import rejects an existing library name", duplicateImport.status === 400);

  const badImport = await request("POST", "/component-libraries/import", {
    body: { kind: "wrong", components: [] },
    status: 400,
  });
  check("import rejects a malformed bundle", badImport.status === 400);

  const removedComponent = (
    await request(
      "DELETE",
      `/component-libraries/${importedLibrary.id}/components/${importedLibrary.components[0].id}`,
    )
  ).payload;
  check(
    "remove a component from the library",
    removedComponent.library.components.length === 0,
    JSON.stringify(removedComponent),
  );

  await request("DELETE", `/component-libraries/${importedLibrary.id}`);
  const listsAfterDelete = (await request("GET", "/component-libraries")).payload;
  check(
    "deleting libraries removes them from the list",
    !listsAfterDelete.libraries.some((l) => l.id === libraryA.id) &&
      !listsAfterDelete.libraries.some((l) => l.id === importedLibrary.id),
  );

  // --- Assets --------------------------------------------------------------
  const upload = (
    await request("POST", `/projects/${project.id}/assets`, {
      body: {
        fileName: "pixel.png",
        mimeType: "image/png",
        dataBase64: PNG_BASE64,
      },
    })
  ).payload;
  check("upload PNG asset", Boolean(upload.id) && upload.mimeType === "image/png", JSON.stringify(upload));

  const list = (await request("GET", `/projects/${project.id}/assets`)).payload.assets;
  check("asset is listed", list.some((asset) => asset.id === upload.id));

  const raw = await fetch(`${ORIGIN}${upload.url}`);
  const rawBytes = Buffer.from(await raw.arrayBuffer());
  check("raw asset returns the exact bytes", rawBytes.toString("base64") === PNG_BASE64);
  check(
    "raw asset has image + nosniff + immutable headers",
    raw.headers.get("content-type") === "image/png" &&
      raw.headers.get("x-content-type-options") === "nosniff" &&
      (raw.headers.get("cache-control") ?? "").includes("immutable"),
    JSON.stringify(Object.fromEntries(raw.headers)),
  );

  const spoof = await request("POST", `/projects/${project.id}/assets`, {
    body: { fileName: "fake.jpg", mimeType: "image/jpeg", dataBase64: PNG_BASE64 },
    status: 400,
  });
  check("declared MIME must match magic bytes", spoof.status === 400);

  const svg = await request("POST", `/projects/${project.id}/assets`, {
    body: { fileName: "x.svg", mimeType: "image/svg+xml", dataBase64: "PHN2Zy8+" },
    status: 400,
  });
  check("SVG assets are rejected", svg.status === 400);

  const crossAsset = await fetch(`${ORIGIN}/api/projects/${isolation.id}/assets/${upload.id}/raw`);
  check("asset from another project is not accessible", crossAsset.status === 404);

  await request("DELETE", `/projects/${project.id}/assets/${upload.id}`);
  const deletedRaw = await fetch(`${ORIGIN}${upload.url}`);
  check("deleted asset is gone", deletedRaw.status === 404);

  // --- AI generate / edit --------------------------------------------------
  const generated = (
    await request("POST", "/ai/generate?viewport=mobile", {
      body: { prompt: "Dashboard doanh thu trên mobile" },
    })
  ).payload;
  const parsedDoc = uiDocumentSchema.safeParse(generated.document);
  check("AI generate returns a valid UiDocument", parsedDoc.success);
  check(
    "AI generate honours the requested viewport",
    generated.document.viewport.width === 390 && generated.document.viewport.height === 844,
    JSON.stringify(generated.document.viewport),
  );

  const edited = (
    await request("POST", "/ai/edit", {
      body: {
        prompt: "Đổi tiêu đề trang thành Báo cáo tháng 11",
        document: generated.document,
        targetId: generated.document.root.id,
      },
    })
  ).payload;
  check(
    "AI edit returns valid patches + document",
    Array.isArray(edited.patches) &&
      edited.patches.length > 0 &&
      uiDocumentSchema.safeParse(edited.document).success,
  );

  const critique = (
    await request("POST", "/ai/critique", {
      body: { document: generated.document, viewportMode: "mobile" },
    })
  ).payload;
  check(
    "AI critique returns a score, summary and findings",
    typeof critique.score === "number" &&
      critique.score >= 0 &&
      critique.score <= 100 &&
      typeof critique.summary === "string" &&
      Array.isArray(critique.findings),
    JSON.stringify({ score: critique.score, findings: critique.findings?.length }),
  );
  check(
    "AI critique works offline with the heuristic analyzer",
    localAnalyzerOk(critique.source),
  );
  check(
    "AI critique findings are well-formed",
    critique.findings.every(
      (finding) =>
        typeof finding.id === "string" &&
        typeof finding.category === "string" &&
        ["high", "medium", "low"].includes(finding.severity) &&
        typeof finding.title === "string" &&
        typeof finding.suggestion === "string",
    ),
  );

  const dummy = (
    await request("POST", "/ai/dummy-data", {
      body: { document: generated.document, locale: "vi" },
    })
  ).payload;
  check(
    "AI dummy data returns changes",
    Array.isArray(dummy.changes) && dummy.changes.length > 0,
    `changes=${dummy.changes?.length}`,
  );
  check(
    "AI dummy data works offline with the local generator",
    localAnalyzerOk(dummy.source),
  );
  check(
    "AI dummy data changes reference real nodes and type-safe props",
    dummy.changes.every((change) => {
      if (typeof change.nodeId !== "string") return false;
      if (!["dashboard.stats", "dashboard.table", "dashboard.chart"].includes(change.nodeType)) {
        return true;
      }
      if (change.nodeType === "dashboard.stats") {
        const items = change.props?.items;
        const values = change.props?.values;
        return (
          Array.isArray(items) &&
          Array.isArray(values) &&
          items.length === values.length &&
          items.every((item) => typeof item === "string")
        );
      }
      if (change.nodeType === "dashboard.table") {
        const headers = change.props?.headers;
        const rows = change.props?.rows;
        if (!Array.isArray(rows) || rows.length === 0) return false;
        const widths = new Set(rows.map((row) => (Array.isArray(row) ? row.length : -1)));
        if (widths.size !== 1) return false;
        if (Array.isArray(headers) && rows.some((row) => row.length !== headers.length)) {
          return false;
        }
        return true;
      }
      return typeof change.props?.title === "string";
    }),
  );

  const dummyTarget = dummy.changes[0]?.nodeId;
  const scopedDummy = (
    await request("POST", "/ai/dummy-data", {
      body: { document: generated.document, nodeId: dummyTarget, locale: "vi" },
    })
  ).payload;
  check(
    "AI dummy data honours the node scope",
    scopedDummy.changes.length === 1 && scopedDummy.changes[0].nodeId === dummyTarget,
  );

  // The analyzer must be tested against a KNOWN-bad document: with a real
  // LLM the generated page can come back perfectly responsive, and the
  // suite would fail for the wrong reason. This fixture violates the width,
  // row-direction, grid-column and spacing rules.
  const responsiveFixture = makeDoc("Responsive fixture");
  responsiveFixture.root.styles = { width: 1200 };
  responsiveFixture.root.children.push(
    {
      id: "row",
      type: "layout.container",
      styles: { display: "flex", flexDirection: "row", padding: 48 },
      children: [{ id: "cell", type: "basic.text", props: { text: "Cột" } }],
    },
    { id: "grid", type: "layout.grid", props: { columns: 4 }, children: [] },
  );

  const responsive = (
    await request("POST", "/ai/responsive", {
      body: { document: responsiveFixture },
    })
  ).payload;
  check(
    "AI responsive returns suggestions",
    Array.isArray(responsive.suggestions) && responsive.suggestions.length > 0,
    `count=${responsive.suggestions?.length}`,
  );
  check(
    "AI responsive works offline with the local analyzer",
    localAnalyzerOk(responsive.source),
  );

  const responsiveNodeIds = new Set();
  const collectResponsiveIds = (node) => {
    responsiveNodeIds.add(node.id);
    (node.children ?? []).forEach(collectResponsiveIds);
  };
  collectResponsiveIds(responsiveFixture.root);
  check(
    "AI responsive suggestions are safe and target real nodes",
    responsive.suggestions.every(
      (suggestion) =>
        ["tablet", "mobile"].includes(suggestion.breakpoint) &&
        responsiveNodeIds.has(suggestion.nodeId) &&
        suggestion.styles &&
        typeof suggestion.styles === "object" &&
        Object.keys(suggestion.styles).length > 0,
    ),
  );

  const mobileOnly = (
    await request("POST", "/ai/responsive", {
      body: { document: responsiveFixture, breakpoints: ["mobile"] },
    })
  ).payload;
  check(
    "AI responsive honours breakpoint filters",
    mobileOnly.suggestions.every((suggestion) => suggestion.breakpoint === "mobile"),
  );

  const recommend = (
    await request("POST", "/ai/recommend-components", {
      body: {
        document: generated.document,
        prompt: "thêm bảng đơn hàng và biểu đồ doanh thu",
      },
    })
  ).payload;
  check(
    "AI recommend returns suggestions",
    Array.isArray(recommend.suggestions) && recommend.suggestions.length > 0,
    `count=${recommend.suggestions?.length}`,
  );
  check(
    "AI recommend works offline with the local analyzer",
    localAnalyzerOk(recommend.source),
  );
  check(
    "AI recommend only returns registered component types",
    recommend.suggestions.every(
      (suggestion) =>
        knownComponentTypes.includes(suggestion.type) &&
        typeof suggestion.reason === "string" &&
        suggestion.reason.length > 0 &&
        suggestion.score >= 0 &&
        suggestion.score <= 100,
    ),
  );
  check(
    "AI recommend matches the prompt intent",
    recommend.suggestions.some((suggestion) => suggestion.type === "dashboard.table") &&
      recommend.suggestions.some((suggestion) => suggestion.type === "dashboard.chart"),
    recommend.suggestions.map((suggestion) => suggestion.type).join(","),
  );

  const imageToUi = (
    await request("POST", "/ai/image-to-ui", {
      body: {
        imageBase64: PNG_BASE64,
        mimeType: "image/png",
        prompt: "Dashboard doanh thu",
      },
    })
  ).payload;
  check(
    "AI image-to-ui works offline with the local analyzer",
    localAnalyzerOk(imageToUi.source),
  );
  check(
    "AI image-to-ui returns a valid document",
    uiDocumentSchema.safeParse(imageToUi.document).success,
  );
  check(
    "AI image-to-ui reads the image dimensions",
    imageToUi.image?.width === 1 && imageToUi.image?.height === 1,
    JSON.stringify(imageToUi.image),
  );
  check(
    "AI image-to-ui builds a dashboard layout",
    imageToUi.document?.root?.children?.some(
      (node) => node.type === "layout.sidebar",
    ) === true,
  );

  const urlToUi = (
    await request("POST", "/ai/url-to-ui", {
      body: { url: "http://127.0.0.1:3199/" },
    })
  ).payload;
  check(
    "AI url-to-ui works offline with the local analyzer",
    localAnalyzerOk(urlToUi.source),
  );
  check(
    "AI url-to-ui returns a valid document",
    uiDocumentSchema.safeParse(urlToUi.document).success,
  );
  check(
    "AI url-to-ui extracts the page title",
    urlToUi.site?.title === "Acme Landing" &&
      urlToUi.document?.name?.includes("Acme Landing"),
    JSON.stringify({ site: urlToUi.site, name: urlToUi.document?.name }),
  );
  check(
    "AI url-to-ui builds navigation and sections",
    urlToUi.document?.root?.children?.some((node) => node.type === "layout.navbar") ===
      true && JSON.stringify(urlToUi.document).includes('"type":"formal.card"'),
  );
  const redirected = (
    await request("POST", "/ai/url-to-ui", {
      body: { url: "http://127.0.0.1:3199/redirect" },
    })
  ).payload;
  check(
    "AI url-to-ui follows safe redirects",
    redirected.url === "http://127.0.0.1:3199/",
    redirected.url,
  );
  const privateBlocked = await request("POST", "/ai/url-to-ui", {
    body: { url: "http://127.0.0.1:3100/api/health" },
    status: 400,
  });
  check(
    "AI url-to-ui blocks private URLs",
    /nội bộ|chặn/.test(String(privateBlocked.payload?.message ?? "")),
    String(privateBlocked.payload?.message ?? ""),
  );
  const schemeBlocked = await request("POST", "/ai/url-to-ui", {
    body: { url: "file:///etc/passwd" },
    status: 400,
  });
  check(
    "AI url-to-ui blocks non-http URLs",
    /http\/https/.test(String(schemeBlocked.payload?.message ?? "")),
    String(schemeBlocked.payload?.message ?? ""),
  );

  const designRef = (
    await request("POST", "/ai/design-reference", {
      body: {
        imageBase64: PNG_BASE64,
        mimeType: "image/png",
        palette: ["#FFFFFF", "#2563EB", "#0F172A"],
      },
    })
  ).payload;
  check(
    "AI design-reference works offline with the local analyzer",
    localAnalyzerOk(designRef.source),
  );
  check(
    "AI design-reference returns a palette and theme tokens",
    Array.isArray(designRef.palette) &&
      designRef.palette.length > 0 &&
      designRef.palette.every((color) => /^#[0-9A-F]{6}$/i.test(color.hex)) &&
      /^#[0-9A-F]{6}$/i.test(designRef.theme?.primary ?? "") &&
      /^#[0-9A-F]{6}$/i.test(designRef.theme?.background ?? "") &&
      /^#[0-9A-F]{6}$/i.test(designRef.theme?.foreground ?? "") &&
      typeof designRef.theme?.radius === "number",
  );
  check(
    "AI design-reference honours the client-extracted palette",
    designRef.theme?.background === "#FFFFFF" &&
      designRef.theme?.primary === "#2563EB" &&
      designRef.theme?.foreground === "#0F172A",
    JSON.stringify(designRef.theme),
  );
  check(
    "AI design-reference assigns semantic roles",
    designRef.palette.some((color) => color.role === "background") &&
      designRef.palette.some((color) => color.role === "foreground") &&
      designRef.palette.some((color) => color.role === "primary"),
    JSON.stringify(designRef.palette),
  );

  // --- Duplicate (document + assets) --------------------------------------
  const dupAsset = (
    await request("POST", `/projects/${project.id}/assets`, {
      body: {
        fileName: "duplicate.png",
        mimeType: "image/png",
        dataBase64: PNG_BASE64,
      },
    })
  ).payload;
  const docWithImage = makeDoc("E2E v2");
  docWithImage.root.children.push({
    id: "duplicate-image",
    type: "basic.image",
    hidden: true,
    locked: true,
    responsive: {
      tablet: { width: 180 },
      mobile: { width: 120, opacity: 0.5 },
    },
    props: { src: dupAsset.url, alt: "duplicate" },
  });
  await request("POST", `/projects/${project.id}/document`, {
    body: { document: docWithImage },
  });

  const copy = (
    await request("POST", `/projects/${project.id}/duplicate`)
  ).payload;
  check("duplicate project", copy.name.endsWith("(bản sao)"));
  const copiedDoc = (await request("GET", `/projects/${copy.id}/document`)).payload.document;
  check("duplicate copies the current document", copiedDoc?.name === "E2E v2");

  const copiedImage = copiedDoc?.root.children.find(
    (node) => node.id === "duplicate-image",
  );
  const copiedSrc = copiedImage?.props?.src;
  check(
    "duplicate rewrites image URLs to the copied asset",
    typeof copiedSrc === "string" &&
      copiedSrc.includes(`/projects/${copy.id}/assets/`) &&
      copiedSrc !== dupAsset.url,
    String(copiedSrc),
  );
  check(
    "hidden/locked layer flags survive save and duplicate",
    copiedImage?.hidden === true && copiedImage?.locked === true,
    JSON.stringify({ hidden: copiedImage?.hidden, locked: copiedImage?.locked }),
  );
  check(
    "responsive overrides survive save and duplicate",
    copiedImage?.responsive?.tablet?.width === 180 &&
      copiedImage?.responsive?.mobile?.width === 120 &&
      copiedImage?.responsive?.mobile?.opacity === 0.5,
    JSON.stringify(copiedImage?.responsive),
  );

  const copiedAssets = (
    await request("GET", `/projects/${copy.id}/assets`)
  ).payload.assets;
  check("duplicate copies assets", copiedAssets.length === 1, `assets=${copiedAssets.length}`);
  const copiedRaw = await fetch(`${ORIGIN}${copiedSrc}`);
  const copiedBytes = Buffer.from(await copiedRaw.arrayBuffer());
  check("copied asset row returns the same bytes", copiedBytes.toString("base64") === PNG_BASE64);

  // --- Observability -------------------------------------------------------
  const metrics = (await request("GET", "/metrics")).payload;
  check("metrics recorded requests", metrics.requests.total >= 10, `total=${metrics.requests.total}`);
  check("metrics recorded AI generate", metrics.ai.generate.requests >= 1);
  check("metrics recorded AI edit", metrics.ai.edit.requests >= 1);
  check("metrics recorded AI critique", metrics.ai.critique.requests >= 1);
  check("metrics recorded AI dummy data", metrics.ai.dummy.requests >= 2);
  check("metrics recorded AI responsive", metrics.ai.responsive.requests >= 2);
  check("metrics recorded AI recommend", metrics.ai.recommend.requests >= 1);
  check("metrics recorded AI image-to-ui", metrics.ai.image.requests >= 1);
  check("metrics recorded AI url-to-ui", metrics.ai.url.requests >= 2);
  check("metrics recorded AI design-reference", metrics.ai.design.requests >= 1);
  check("metrics recorded AI multi-page", metrics.ai.multi.requests >= 1);
  check(
    "metrics group routes",
    metrics.routes.some((route) => route.method === "POST" && route.route === "/api/projects"),
  );

  // --- Role-based access control (plan/07 4.5) -----------------------------
  if (process.env.DATABASE_URL) {
    const rbacSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const viewerEmail = `viewer-${rbacSuffix}@example.com`;
    const editorEmail = `editor-${rbacSuffix}@example.com`;
    const adminEmail = `admin-${rbacSuffix}@example.com`;
    const outsiderEmail = `outsider-${rbacSuffix}@example.com`;
    const ghostEmail = `ghost-${rbacSuffix}@example.com`;

    // There is no user-management API in the MVP: create the extra identities
    // directly so we can exercise role enforcement over HTTP.
    const usersClient = new Client({ connectionString: process.env.DATABASE_URL });
    await usersClient.connect();
    try {
      for (const [email, name] of [
        [viewerEmail, "Viewer"],
        [editorEmail, "Editor"],
        [adminEmail, "Admin"],
        [outsiderEmail, "Outsider"],
      ]) {
        await usersClient.query(
          "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
          [randomUUID(), email, name],
        );
      }
    } finally {
      await usersClient.end();
    }

    const as = (email) => ({ "x-user-email": email });

    // The demo user creates a project and is its owner.
    const rbacProject = (
      await request("POST", "/projects", { body: { name: `RBAC ${rbacSuffix}` } })
    ).payload;

    // Seed a document/page so viewers have something to read.
    await request("POST", `/projects/${rbacProject.id}/document`, {
      body: { document: makeDoc("RBAC seed") },
    });

    await request("GET", `/projects/${rbacProject.id}`, {
      status: 403,
      headers: as(outsiderEmail),
    });
    check("non-members are rejected from a project", true);

    await request("GET", `/projects/${rbacProject.id}`, {
      status: 403,
      headers: as(ghostEmail),
    });
    check("unknown identities do not inherit demo owner access", true);

    const ownerMembers = (
      await request("GET", `/projects/${rbacProject.id}/members`)
    ).payload;
    check(
      "owner is listed implicitly with the owner role",
      ownerMembers.canManage === true &&
        ownerMembers.members.length === 1 &&
        ownerMembers.members[0]?.role === "owner",
      JSON.stringify(ownerMembers),
    );

    const viewerMember = (
      await request("POST", `/projects/${rbacProject.id}/members`, {
        body: { email: viewerEmail, role: "viewer" },
      })
    ).payload;
    const editorMember = (
      await request("POST", `/projects/${rbacProject.id}/members`, {
        body: { email: editorEmail, role: "editor" },
      })
    ).payload;
    const adminMember = (
      await request("POST", `/projects/${rbacProject.id}/members`, {
        body: { email: adminEmail, role: "admin" },
      })
    ).payload;
    check(
      "owner adds members with viewer/editor/admin roles",
      viewerMember.role === "viewer" &&
        editorMember.role === "editor" &&
        adminMember.role === "admin" &&
        viewerMember.user.email === viewerEmail,
      JSON.stringify({ viewerMember, editorMember, adminMember }),
    );

    await request("POST", `/projects/${rbacProject.id}/members`, {
      body: { email: viewerEmail, role: "editor" },
      status: 400,
    });
    check("duplicate membership is rejected", true);

    await request("POST", `/projects/${rbacProject.id}/members`, {
      body: { email: `nobody-${rbacSuffix}@example.com`, role: "viewer" },
      status: 404,
    });
    check("adding an unknown user is rejected", true);

    const viewerProjects = (
      await request("GET", "/projects", { headers: as(viewerEmail) })
    ).payload;
    check(
      "members see the shared project in their project list",
      viewerProjects.some((p) => p.id === rbacProject.id),
      JSON.stringify(viewerProjects.map((p) => p.id)),
    );

    const viewerDoc = (
      await request("GET", `/projects/${rbacProject.id}/document`, {
        headers: as(viewerEmail),
      })
    ).payload;
    check("viewer can read the document", viewerDoc.projectId === rbacProject.id);

    const viewerPages = (
      await request("GET", `/projects/${rbacProject.id}/pages`, {
        headers: as(viewerEmail),
      })
    ).payload;
    check(
      "viewer can list pages",
      viewerPages.projectId === rbacProject.id && viewerPages.pages.length >= 1,
      JSON.stringify(viewerPages.pages?.map((p) => p.id)),
    );

    await request("POST", `/projects/${rbacProject.id}/document`, {
      body: { document: makeDoc("Viewer edit") },
      status: 403,
      headers: as(viewerEmail),
    });
    await request("POST", `/projects/${rbacProject.id}/pages`, {
      body: { name: "Viewer page" },
      status: 403,
      headers: as(viewerEmail),
    });
    await request("POST", `/projects/${rbacProject.id}/assets`, {
      body: {
        fileName: "viewer.png",
        mimeType: "image/png",
        dataBase64: PNG_BASE64,
      },
      status: 403,
      headers: as(viewerEmail),
    });
    await request("POST", `/projects/${rbacProject.id}/shares`, {
      body: { visibility: "public" },
      status: 403,
      headers: as(viewerEmail),
    });
    await request("POST", `/projects/${rbacProject.id}`, {
      body: { name: "Renamed by viewer" },
      status: 403,
      headers: as(viewerEmail),
    });
    check("viewer is read-only across write endpoints", true);

    await request("POST", `/projects/${rbacProject.id}/members`, {
      body: { email: outsiderEmail, role: "viewer" },
      status: 403,
      headers: as(viewerEmail),
    });
    check("viewer cannot manage members", true);

    const viewerVersions = (
      await request("GET", `/projects/${rbacProject.id}/versions`, {
        headers: as(viewerEmail),
      })
    ).payload;
    check("viewer can read version history", Array.isArray(viewerVersions.versions));

    const editorDoc = (
      await request("POST", `/projects/${rbacProject.id}/document`, {
        body: { document: makeDoc("Editor edit") },
        headers: as(editorEmail),
      })
    ).payload;
    check(
      "editor can save the document",
      editorDoc.document?.name === "Editor edit",
      JSON.stringify(editorDoc.document?.name),
    );

    await request("POST", `/projects/${rbacProject.id}/members`, {
      body: { email: outsiderEmail, role: "viewer" },
      status: 403,
      headers: as(editorEmail),
    });
    check("editor cannot manage members", true);

    await request("DELETE", `/projects/${rbacProject.id}`, {
      status: 403,
      headers: as(editorEmail),
    });
    check("editor cannot delete the project", true);

    const adminAdded = (
      await request("POST", `/projects/${rbacProject.id}/members`, {
        body: { email: outsiderEmail, role: "viewer" },
        headers: as(adminEmail),
      })
    ).payload;
    check("admin can add members", adminAdded.role === "viewer");

    const adminMembers = (
      await request("GET", `/projects/${rbacProject.id}/members`, {
        headers: as(adminEmail),
      })
    ).payload;
    check(
      "admin sees canManage and every member",
      adminMembers.canManage === true && adminMembers.members.length === 5,
      JSON.stringify({ canManage: adminMembers.canManage, count: adminMembers.members.length }),
    );

    const promoted = (
      await request(
        "PATCH",
        `/projects/${rbacProject.id}/members/${adminAdded.id}`,
        { body: { role: "editor" }, headers: as(adminEmail) },
      )
    ).payload;
    check("admin can change a member role", promoted.role === "editor");

    const ownerPromotesEditor = (
      await request(
        "PATCH",
        `/projects/${rbacProject.id}/members/${editorMember.id}`,
        { body: { role: "admin" } },
      )
    ).payload;
    check("owner can promote an editor to admin", ownerPromotesEditor.role === "admin");

    await request(
      "PATCH",
      `/projects/${rbacProject.id}/members/${editorMember.id}`,
      { body: { role: "viewer" }, status: 403, headers: as(adminEmail) },
    );
    check("an admin cannot demote another admin", true);

    await request(
      "PATCH",
      `/projects/${rbacProject.id}/members/${editorMember.id}`,
      { body: { role: "editor" } },
    );
    check("owner can demote an admin back to editor", true);

    await request("DELETE", `/projects/${rbacProject.id}`, {
      status: 403,
      headers: as(adminEmail),
    });
    check("admin cannot delete the project", true);

    await request(
      "DELETE",
      `/projects/${rbacProject.id}/members/${adminAdded.id}`,
      { headers: as(adminEmail) },
    );
    await request("GET", `/projects/${rbacProject.id}/document`, {
      status: 403,
      headers: as(outsiderEmail),
    });
    check("removed members lose access", true);

    await request("DELETE", `/projects/${rbacProject.id}`);
    await request("GET", `/projects/${rbacProject.id}`, { status: 404 });
    check("owner can delete the project", true);
  } else {
    console.log("  - skip RBAC checks (DATABASE_URL not set)");
  }

  // --- Team collaboration (plan/07 4.4) -----------------------------------
  if (process.env.DATABASE_URL) {
    const collabSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const collaboratorEmail = `collab-${collabSuffix}@example.com`;
    const ghostEmail = `collab-ghost-${collabSuffix}@example.com`;
    const ghostProjectId = randomUUID();

    const collabUsers = new Client({ connectionString: process.env.DATABASE_URL });
    await collabUsers.connect();
    try {
      await collabUsers.query(
        "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
        [randomUUID(), collaboratorEmail, "Collaborator"],
      );
    } finally {
      await collabUsers.end();
    }

    const collabProject = (
      await request("POST", "/projects", {
        body: { name: `Collab ${collabSuffix}` },
      })
    ).payload;
    await request("POST", `/projects/${collabProject.id}/document`, {
      body: { document: makeDoc("Collab v1") },
    });
    await request("POST", `/projects/${collabProject.id}/members`, {
      body: { email: collaboratorEmail, role: "viewer" },
    });

    const ownerWs = await connectPresence(collabProject.id);
    const viewerWs = await connectPresence(collabProject.id, collaboratorEmail);

    const roster = await waitForMessage(
      ownerWs,
      (m) => m.type === "presence" && m.users.length === 2,
      "presence roster with two users",
    );
    check(
      "two users see each other in presence",
      roster.users.map((u) => u.email).sort().join(",") ===
        ["demo@mockup.studio", collaboratorEmail].sort().join(","),
      JSON.stringify(roster.users),
    );
    check(
      "presence exposes each user's role",
      roster.users.find((u) => u.email === collaboratorEmail)?.role === "viewer" &&
        roster.users.find((u) => u.email === "demo@mockup.studio")?.role ===
          "owner",
      JSON.stringify(roster.users),
    );

    const before = (
      await request("GET", `/projects/${collabProject.id}/document`)
    ).payload;
    await request("POST", `/projects/${collabProject.id}/document`, {
      body: {
        document: makeDoc("Stale write"),
        baseVersion: "2000-01-01T00:00:00.000Z",
      },
      status: 409,
    });
    const afterStale = (
      await request("GET", `/projects/${collabProject.id}/document`)
    ).payload;
    check(
      "stale save is rejected instead of overwriting",
      afterStale.document?.name === "Collab v1",
      JSON.stringify(afterStale.document?.name),
    );

    const saved = (
      await request("POST", `/projects/${collabProject.id}/document`, {
        body: {
          document: makeDoc("Collab v2"),
          baseVersion: String(before.revision),
        },
      })
    ).payload;
    check(
      "save with the current baseVersion succeeds",
      saved.document?.name === "Collab v2",
      JSON.stringify(saved.document?.name),
    );

    const updateMessage = await waitForMessage(
      viewerWs,
      (m) => m.type === "document:updated",
      "document update broadcast",
    );
    check(
      "collaborators receive document updates in real time",
      updateMessage.pageId === before.currentPageId &&
        updateMessage.actor?.email === "demo@mockup.studio",
      JSON.stringify(updateMessage),
    );

    await request("POST", `/projects/${collabProject.id}/document`, {
      body: {
        document: makeDoc("Second stale write"),
        baseVersion: String(before.revision),
      },
      status: 409,
    });
    const afterSecond = (
      await request("GET", `/projects/${collabProject.id}/document`)
    ).payload;
    check(
      "a second stale write cannot overwrite the newer version",
      afterSecond.document?.name === "Collab v2",
      JSON.stringify(afterSecond.document?.name),
    );

    viewerWs.close();
    await waitForClose(viewerWs);
    const soloRoster = await waitForMessage(
      ownerWs,
      (m) => m.type === "presence" && m.users.length === 1,
      "presence roster after leave",
    );
    check(
      "leaving the project removes the user from presence",
      soloRoster.users[0]?.email === "demo@mockup.studio",
      JSON.stringify(soloRoster.users),
    );

    const ghostWs = await connectPresence(collabProject.id, ghostEmail);
    const ghostCode = await waitForClose(ghostWs);
    check(
      "presence rejects unknown identities",
      ghostCode === 4403,
      `code=${ghostCode}`,
    );

    const missingWs = await connectPresence(ghostProjectId);
    const missingCode = await waitForClose(missingWs);
    check(
      "presence rejects unknown projects",
      missingCode === 4404,
      `code=${missingCode}`,
    );

    ownerWs.close();
    await waitForClose(ownerWs);
    await request("DELETE", `/projects/${collabProject.id}`);
  } else {
    console.log("  - skip collaboration checks (DATABASE_URL not set)");
  }

  // --- API SDK (plan/07 4.9) ------------------------------------------------
  {
    const { MockupClient, MockupError } = await import(
      "../../../packages/sdk/dist/index.js"
    );
    const sdk = new MockupClient({ baseUrl: API_URL });

    sdkProject = await sdk.createProject({
      name: `SDK ${Date.now().toString(36)}`,
      description: "created via SDK",
    });
    check("SDK creates a project", Boolean(sdkProject.id), sdkProject.id);

    const sdkList = await sdk.listProjects();
    check(
      "SDK lists projects including the new one",
      sdkList.some((p) => p.id === sdkProject.id),
    );

    const emptyDoc = await sdk.getDocument(sdkProject.id);
    check(
      "SDK reads the empty document with revision 0",
      emptyDoc.revision === 0 && emptyDoc.document === null,
      `revision=${emptyDoc.revision}`,
    );

    // The first save creates the home page (a brand-new document starts at
    // revision 0), so do it twice before asserting revision advancement.
    await sdk.saveDocument(sdkProject.id, makeDoc("SDK v1"), "0");
    const sdkDoc = await sdk.getDocument(sdkProject.id);
    check(
      "SDK saves the document and creates the home page",
      sdkDoc.document?.name === "SDK v1" && sdkDoc.document !== null,
      JSON.stringify(sdkDoc.document?.name),
    );

    await sdk.saveDocument(sdkProject.id, makeDoc("SDK v2"), String(sdkDoc.revision));
    const sdkDoc2 = await sdk.getDocument(sdkProject.id);
    check(
      "SDK advances the revision on a second save",
      sdkDoc2.revision === sdkDoc.revision + 1,
      `revision=${sdkDoc2.revision}`,
    );

    // That old baseVersion is now stale, so the save must be rejected 409.
    let sdkConflict = false;
    try {
      await sdk.saveDocument(sdkProject.id, makeDoc("Stale via SDK"), String(sdkDoc.revision));
    } catch (error) {
      sdkConflict = error instanceof MockupError && error.statusCode === 409;
    }
    check("SDK surfaces 409 on stale baseVersion", sdkConflict, `conflict=${sdkConflict}`);
  }

  // --- Organization workspace (plan/07 4.11) -------------------------------
  if (process.env.DATABASE_URL) {
    const orgSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const orgMemberEmail = `org-member-${orgSuffix}@example.com`;
    const orgAdminEmail = `org-admin-${orgSuffix}@example.com`;
    const orgOutsiderEmail = `org-outsider-${orgSuffix}@example.com`;

    const usersClient = new Client({ connectionString: process.env.DATABASE_URL });
    await usersClient.connect();
    try {
      for (const [email, name] of [
        [orgMemberEmail, "Org Member"],
        [orgAdminEmail, "Org Admin"],
        [orgOutsiderEmail, "Org Outsider"],
      ]) {
        await usersClient.query(
          "INSERT INTO users (id, email, name) VALUES ($1, $2, $3)",
          [randomUUID(), email, name],
        );
      }
    } finally {
      await usersClient.end();
    }

    const as = (email) => ({ "x-user-email": email });

    // The demo user creates an organization and owns it.
    const org = (
      await request("POST", "/organizations", {
        body: { name: `Studio Org ${orgSuffix}` },
      })
    ).payload;
    check("owner creates an organization", Boolean(org.id) && org.ownerId !== null, org.id);

    const orgs = (await request("GET", "/organizations")).payload;
    check(
      "owner sees the organization in their org list",
      orgs.organizations.some((o) => o.id === org.id),
    );

    const orgDetail = (await request("GET", `/organizations/${org.id}`)).payload;
    check(
      "org detail reports the owner role and canManage",
      orgDetail.myRole === "owner" && orgDetail.canManage === true,
      JSON.stringify({ myRole: orgDetail.myRole, canManage: orgDetail.canManage }),
    );

    const memberRow = (
      await request("POST", `/organizations/${org.id}/members`, {
        body: { email: orgMemberEmail, role: "member" },
      })
    ).payload;
    const adminRow = (
      await request("POST", `/organizations/${org.id}/members`, {
        body: { email: orgAdminEmail, role: "admin" },
      })
    ).payload;
    check(
      "owner adds org members with member/admin roles",
      memberRow.role === "member" &&
        adminRow.role === "admin" &&
        memberRow.user.email === orgMemberEmail,
      JSON.stringify({ memberRow, adminRow }),
    );

    await request("POST", `/organizations/${org.id}/members`, {
      body: { email: orgMemberEmail, role: "admin" },
      status: 400,
    });
    check("duplicate org membership is rejected", true);

    await request("POST", `/organizations/${org.id}/members`, {
      body: { email: `nobody-${orgSuffix}@example.com`, role: "member" },
      status: 404,
    });
    check("adding an unknown org member is rejected", true);

    const orgMembers = (await request("GET", `/organizations/${org.id}/members`)).payload;
    check(
      "org member list includes the implicit owner first",
      orgMembers.canManage === true &&
        orgMembers.members.length === 3 &&
        orgMembers.members[0]?.role === "owner",
      JSON.stringify(orgMembers.members.map((m) => m.role)),
    );

    // Someone outside the org has no access to the org.
    await request("GET", `/organizations/${org.id}`, {
      status: 404,
      headers: as(orgOutsiderEmail),
    });
    check("org outsiders are rejected", true);

    // Transfer a new project into the organization.
    const orgNewProject = (
      await request("POST", "/projects", {
        body: { name: `Org project ${orgSuffix}` },
      })
    ).payload;
    const orgProject = (
      await request("POST", `/projects/${orgNewProject.id}/organization`, {
        body: { organizationId: org.id },
      })
    ).payload;
    check(
      "owner transfers a project into the organization",
      orgProject.organizationId === org.id,
      `org=${orgProject.organizationId}`,
    );

    // The org member now sees the project in their list with viewer access.
    const memberProjects = (
      await request("GET", "/projects", { headers: as(orgMemberEmail) })
    ).payload;
    check(
      "org members see org projects in their list",
      memberProjects.some((p) => p.id === orgNewProject.id && p.organizationId === org.id),
      JSON.stringify(memberProjects.map((p) => p.id)),
    );

    await request("GET", `/projects/${orgNewProject.id}/document`, {
      headers: as(orgMemberEmail),
    });
    check("org members have read (viewer) access to org projects", true);

    await request("POST", `/projects/${orgNewProject.id}/document`, {
      headers: as(orgMemberEmail),
      body: { document: makeDoc("org member edit") },
      status: 403,
    });
    check("org members cannot edit org projects (viewer)", true);

    await request("POST", `/projects/${orgNewProject.id}/document`, {
      headers: as(orgAdminEmail),
      body: { document: makeDoc("org admin edit") },
    });
    check("org admins have editor access to org projects", true);

    // An org outsider still has no project access via the org.
    await request("GET", `/projects/${orgNewProject.id}`, {
      status: 403,
      headers: as(orgOutsiderEmail),
    });
    check("org outsiders have no project access", true);

    // Detach back to a personal project.
    const reverted = (
      await request("POST", `/projects/${orgNewProject.id}/organization`, {
        body: { organizationId: null },
      })
    ).payload;
    check(
      "owner transfers the project back to a personal project",
      reverted.organizationId === null,
    );

    // Deleting the org cascades its memberships but not the project.
    await request("DELETE", `/organizations/${org.id}`);
    await request("GET", `/organizations/${org.id}`, { status: 404 });
    check("owner deletes the organization", true);

    const afterDelete = (await request("GET", `/projects/${orgNewProject.id}`)).payload;
    check(
      "deleting an org detaches its projects",
      afterDelete.organizationId === null,
    );
  } else {
    console.log("  - skip organization checks (DATABASE_URL not set)");
  }

  // --- Plugin ecosystem (plan/07 4.10) -------------------------------------
  {
    const plugins = (await request("GET", "/plugins")).payload;
    check(
      "plugin catalog lists built-in plugins",
      Array.isArray(plugins.plugins) && plugins.plugins.some((p) => p.id === "doc-analyzer"),
      JSON.stringify(plugins.plugins?.map((p) => p.id)),
    );

    const detail = (await request("GET", "/plugins/doc-analyzer")).payload;
    check(
      "plugin detail includes the full manifest",
      detail.id === "doc-analyzer" && typeof detail.manifest?.main === "string",
    );

    // Seed the plugin project with a few text nodes.
    const pluginProject = (
      await request("POST", "/projects", {
        body: { name: `Plugin ${Date.now().toString(36)}` },
      })
    ).payload;
    await request("POST", `/projects/${pluginProject.id}/document`, {
      body: {
        document: {
          ...makeDoc("plugin base"),
          root: {
            id: "root",
            type: "layout.container",
            children: [
              { id: "t1", type: "typography.text", props: { text: "lower case A" } },
              { id: "t2", type: "typography.text", props: { text: "lower case B" } },
            ],
          },
        },
      },
    });

    // Read-only analyzer: returns stats and does not change the document.
    const analyzeRun = (
      await request("POST", `/projects/${pluginProject.id}/plugins/doc-analyzer/run`, {
        body: {},
      })
    ).payload;
    check(
      "read-only plugin returns stats without changing the document",
      analyzeRun.changedDocument === false &&
        analyzeRun.returnValue?.textNodes === 2 &&
        analyzeRun.timedOut === false,
      JSON.stringify(analyzeRun.returnValue),
    );

    // Write plugin: upper-cases the text and persists a new document.
    const upperRun = (
      await request("POST", `/projects/${pluginProject.id}/plugins/text-uppercase/run`, {
        body: {},
      })
    ).payload;
    check(
      "write plugin transforms and persists the document",
      upperRun.changedDocument === true &&
        upperRun.document?.document?.root?.children?.[0]?.props?.text === "LOWER CASE A" &&
        upperRun.returnValue?.changed === 2,
      JSON.stringify(upperRun.document?.document?.root?.children?.map((c) => c.props?.text)),
    );

    const afterRun = (
      await request("GET", `/projects/${pluginProject.id}/document`)
    ).payload;
    check(
      "plugin-written document is saved through the real document endpoint",
      afterRun.document?.root?.children?.[0]?.props?.text === "LOWER CASE A" &&
        afterRun.document?.root?.children?.[1]?.props?.text === "LOWER CASE B",
      JSON.stringify(afterRun.document?.root?.children?.map((c) => c.props?.text)),
    );

    // A missing plugin is rejected.
    await request("POST", `/projects/${pluginProject.id}/plugins/nope/run`, {
      body: {},
      status: 404,
    });
    check("running an unknown plugin is rejected", true);

    // Non-members cannot run plugins on a project.
    await request("POST", `/projects/${project.id}/plugins/doc-analyzer/run`, {
      body: {},
      status: 403,
      headers: { "x-user-email": `plugin-outsider-${Date.now().toString(36)}@example.com` },
    });
    check("non-members cannot run plugins", true);

    await request("DELETE", `/projects/${pluginProject.id}`);
  }

  // --- Cleanup -------------------------------------------------------------
  for (const id of [
    project.id,
    isolation.id,
    pageCopy.id,
    copy.id,
    dsProject.id,
    dsCopy.id,
    sdkProject?.id,
  ]) {
    await request("DELETE", `/projects/${id}`);
  }
  await request("GET", `/projects/${project.id}`, { status: 404 });
  await request("GET", `/share/${publicShare.token}`, { status: 404 });
  check("deleting a project revokes its shares", true);
  const remaining = (await request("GET", "/projects")).payload;
  check(
    "delete projects",
    ![
      project.id,
      isolation.id,
      pageCopy.id,
      copy.id,
      dsProject.id,
      dsCopy.id,
    ].some((id) => remaining.some((p) => p.id === id)),
  );

  console.log(`\nRESULT: PASS — ${checks.length} checks`);
}

main()
  .catch((error) => {
    console.error(`\nRESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fixtureServer?.close();
  });
