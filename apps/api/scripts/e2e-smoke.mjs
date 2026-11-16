#!/usr/bin/env node
// ---------------------------------------------------------------------------
// API E2E smoke test (plan/12 GĐ 6.5 / CI).
//
// Exercises the full HTTP surface against a running API + seeded Postgres:
// projects CRUD/duplicate, documents save/load, version history + reversible
// restore, cross-project isolation, public/private share links (password,
// expiry, revoke), canvas comment threads (element anchors, replies, resolve,
// status filters, cross-project isolation), assets validation/raw bytes/delete
// and asset copying on duplicate, hidden/locked flags, AI generate/edit and
// observability counters.
//
// Usage: API_URL=http://localhost:3000/api pnpm --filter @ai-mockup-studio/api e2e:api
// Requires the demo user from `pnpm db:seed` (CI seeds before starting the API).
// ---------------------------------------------------------------------------

import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import { knownComponentTypes } from "@ai-mockup-studio/ui-schema";
import { Client } from "pg";
import { createServer } from "node:http";

const API_URL = (process.env.API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
const ORIGIN = new URL(API_URL).origin;
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

async function main() {
  console.log(`API E2E smoke — ${API_URL}`);

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
  check("AI multi-page works offline", multi.source === "heuristic");
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
        nodeId: "title",
        nodeLabel: "Tiêu đề",
        body: "Đổi tiêu đề này rõ hơn",
        authorName: "Reviewer E2E",
      },
    })
  ).payload;
  check(
    "create element comment thread",
    createdComment.pageId === commentPage.id &&
      createdComment.nodeId === "title" &&
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
  check("AI critique works offline with the heuristic analyzer", critique.source === "heuristic");
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
  check("AI dummy data works offline with the local generator", dummy.source === "heuristic");
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

  const responsive = (
    await request("POST", "/ai/responsive", {
      body: { document: generated.document },
    })
  ).payload;
  check(
    "AI responsive returns suggestions",
    Array.isArray(responsive.suggestions) && responsive.suggestions.length > 0,
    `count=${responsive.suggestions?.length}`,
  );
  check(
    "AI responsive works offline with the local analyzer",
    responsive.source === "heuristic",
  );

  const responsiveNodeIds = new Set();
  const collectResponsiveIds = (node) => {
    responsiveNodeIds.add(node.id);
    (node.children ?? []).forEach(collectResponsiveIds);
  };
  collectResponsiveIds(generated.document.root);
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
      body: { document: generated.document, breakpoints: ["mobile"] },
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
    recommend.source === "heuristic",
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
    imageToUi.source === "heuristic",
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
    urlToUi.source === "heuristic",
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
    designRef.source === "heuristic",
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

  // --- Cleanup -------------------------------------------------------------
  for (const id of [project.id, isolation.id, pageCopy.id, copy.id]) {
    await request("DELETE", `/projects/${id}`);
  }
  await request("GET", `/projects/${project.id}`, { status: 404 });
  await request("GET", `/share/${publicShare.token}`, { status: 404 });
  check("deleting a project revokes its shares", true);
  const remaining = (await request("GET", "/projects")).payload;
  check(
    "delete projects",
    ![project.id, isolation.id, pageCopy.id, copy.id].some((id) =>
      remaining.some((p) => p.id === id),
    ),
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
