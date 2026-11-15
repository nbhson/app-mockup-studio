#!/usr/bin/env node
// ---------------------------------------------------------------------------
// API E2E smoke test (plan/12 GĐ 6.5 / CI).
//
// Exercises the full HTTP surface against a running API + seeded Postgres:
// projects CRUD/duplicate, documents save/load, version history + reversible
// restore, cross-project isolation, assets validation/raw bytes/delete and
// asset copying on duplicate, hidden/locked flags, AI generate/edit and
// observability counters.
//
// Usage: API_URL=http://localhost:3000/api pnpm --filter @ai-mockup-studio/api e2e:api
// Requires the demo user from `pnpm db:seed` (CI seeds before starting the API).
// ---------------------------------------------------------------------------

import { uiDocumentSchema } from "@ai-mockup-studio/validators";

const API_URL = (process.env.API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
const ORIGIN = new URL(API_URL).origin;
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const checks = [];
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
  const { body, status } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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

async function main() {
  console.log(`API E2E smoke — ${API_URL}`);

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
  check(
    "metrics group routes",
    metrics.routes.some((route) => route.method === "POST" && route.route === "/api/projects"),
  );

  // --- Cleanup -------------------------------------------------------------
  for (const id of [project.id, isolation.id, copy.id]) {
    await request("DELETE", `/projects/${id}`);
  }
  await request("GET", `/projects/${project.id}`, { status: 404 });
  const remaining = (await request("GET", "/projects")).payload;
  check(
    "delete projects",
    ![project.id, isolation.id, copy.id].some((id) => remaining.some((p) => p.id === id)),
  );

  console.log(`\nRESULT: PASS — ${checks.length} checks`);
}

main().catch((error) => {
  console.error(`\nRESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
