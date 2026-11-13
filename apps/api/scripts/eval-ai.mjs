#!/usr/bin/env node
// ---------------------------------------------------------------------------
// AI evaluation harness (plan/12 GĐ 6.3).
//
// Black-box evaluation against a running API:
//   API_URL=http://localhost:3000/api pnpm --filter @ai-mockup-studio/api eval:ai
//
// - Structural metrics always run (schema validity, unique ids, viewport,
//   suspicious markup).
// - Intent coverage checks expected component types for each prompt.
// - Edit cases verify that returned patches are valid and change the document.
// - With OPENAI_API_KEY configured this measures the real LLM; without it the
//   deterministic mock provider provides a baseline (mock is reported, not
//   counted as a failure).
// ---------------------------------------------------------------------------

import {
  aiEditRequestSchema,
  generateRequestSchema,
  uiDocumentSchema,
  uiPatchSchema,
} from "@ai-mockup-studio/validators";

const API_URL = (process.env.API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");

const CASES = [
  {
    id: "crm-dashboard",
    prompt: "Dashboard CRM bán hàng với doanh thu, biểu đồ và bảng đơn hàng gần đây",
    viewport: "desktop",
    viewportSize: { width: 1440, height: 900 },
    expected: ["dashboard.header", "dashboard.stats", "dashboard.chart", "dashboard.table"],
  },
  {
    id: "hr-management",
    prompt: "Trang quản lý nhân sự: danh sách nhân viên và thống kê phòng ban",
    viewport: "tablet",
    viewportSize: { width: 768, height: 1024 },
    expected: ["dashboard.header", "dashboard.table"],
  },
  {
    id: "finance-report",
    prompt: "Báo cáo doanh thu tài chính theo tháng với biểu đồ cột",
    viewport: "desktop",
    viewportSize: { width: 1440, height: 900 },
    expected: ["dashboard.header", "dashboard.stats", "dashboard.chart"],
  },
  {
    id: "customer-list",
    prompt: "Danh sách khách hàng trên mobile kèm trạng thái",
    viewport: "mobile",
    viewportSize: { width: 390, height: 844 },
    expected: ["dashboard.header", "dashboard.table"],
  },
  {
    id: "signup-form",
    prompt: "Form đăng ký tài khoản gồm email, mật khẩu và nút tạo tài khoản",
    viewport: "desktop",
    viewportSize: { width: 1440, height: 900 },
    expected: ["formal.form", "basic.input", "basic.button"],
  },
  {
    id: "settings-page",
    prompt: "Trang cài đặt người dùng với các trường nhập và nút lưu",
    viewport: "tablet",
    viewportSize: { width: 768, height: 1024 },
    expected: ["formal.form", "basic.button"],
  },
  {
    id: "landing-page",
    prompt: "Landing page giới thiệu sản phẩm với tiêu đề và nút dùng thử",
    viewport: "desktop",
    viewportSize: { width: 1440, height: 900 },
    expected: ["basic.text", "basic.button"],
  },
  {
    id: "marketing-dashboard",
    prompt: "Dashboard phân tích marketing trên mobile với chỉ số và biểu đồ",
    viewport: "mobile",
    viewportSize: { width: 390, height: 844 },
    expected: ["dashboard.header", "dashboard.chart"],
  },
];

const EDIT_CASES = [
  {
    id: "change-title",
    prompt: "Đổi tiêu đề trang thành Báo cáo tháng 11",
    target: "root",
    expectChange: true,
  },
  {
    id: "update-table",
    prompt: "Đổi tiêu đề bảng thành Khách hàng mới",
    targetType: "dashboard.table",
    expectChange: true,
  },
  {
    id: "noop-unknown",
    prompt: "Đổi màu của một thành phần không tồn tại",
    target: "does-not-exist",
    expectChange: false,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, init = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

function collect(node, visit) {
  visit(node);
  for (const child of node.children ?? []) collect(child, visit);
}

function uniqueIds(doc) {
  const seen = new Set();
  let duplicates = 0;
  collect(doc.root, (node) => {
    if (seen.has(node.id)) duplicates += 1;
    seen.add(node.id);
  });
  return duplicates === 0;
}

function nodeCount(doc) {
  let count = 0;
  collect(doc.root, () => {
    count += 1;
  });
  return count;
}

function typeSet(doc) {
  const types = new Set();
  collect(doc.root, (node) => types.add(node.type));
  return types;
}

function findFirst(doc, type) {
  let found = null;
  collect(doc.root, (node) => {
    if (!found && node.type === type) found = node;
  });
  return found;
}

const SUSPICIOUS = [/<script/i, /javascript:/i, /onerror\s*=/i, /<style/i, /<iframe/i];

function hasSuspiciousMarkup(doc) {
  const serialized = JSON.stringify(doc);
  return SUSPICIOUS.some((pattern) => pattern.test(serialized));
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  // Wait for the API (max 30s) so the script is safe to run right after start.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) break;
    } catch {
      // retry
    }
    if (attempt === 59) throw new Error(`API not reachable at ${API_URL}`);
    await sleep(500);
  }

  const results = [];
  for (const testCase of CASES) {
    const started = performance.now();
    let result;
    let error = null;
    try {
      const body = generateRequestSchema.parse({ prompt: testCase.prompt });
      result = await request(`/ai/generate?viewport=${testCase.viewport}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = performance.now() - started;
    if (error) {
      results.push({ ...testCase, error, latencyMs, ok: false });
      continue;
    }

    const parsed = uiDocumentSchema.safeParse(result.document);
    if (!parsed.success) {
      results.push({
        ...testCase,
        error: `Invalid document: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        latencyMs,
        ok: false,
      });
      continue;
    }

    const doc = parsed.data;
    const types = typeSet(doc);
    const covered = testCase.expected.filter((type) => types.has(type));
    results.push({
      ...testCase,
      ok: true,
      mock: /mock provider/i.test(result.summary ?? ""),
      fallback: result.summary?.startsWith("⚠️") ?? false,
      schemaValid: true,
      uniqueIds: uniqueIds(doc),
      viewportMatches:
        doc.viewport.width === testCase.viewportSize.width &&
        doc.viewport.height === testCase.viewportSize.height,
      nodes: nodeCount(doc),
      suspicious: hasSuspiciousMarkup(doc),
      covered,
      coverage: covered.length / testCase.expected.length,
      latencyMs,
      summary: result.summary,
    });
  }

  // Edit evaluation reuses a structurally valid generated document.
  let editBase = null;
  if (results.some((result) => result.ok)) {
    const body = await request(`/ai/generate?viewport=desktop`, {
      method: "POST",
      body: JSON.stringify({ prompt: CASES[0].prompt }),
    });
    editBase = uiDocumentSchema.parse(body.document);
  }

  const editResults = [];
  for (const editCase of EDIT_CASES) {
    if (!editBase) {
      editResults.push({ ...editCase, ok: false, error: "No base document" });
      continue;
    }
    const targetId =
      editCase.targetType
        ? findFirst(editBase, editCase.targetType)?.id ?? null
        : editCase.target;
    const started = performance.now();
    try {
      const body = aiEditRequestSchema.parse({
        prompt: editCase.prompt,
        document: editBase,
        targetId,
      });
      const result = await request("/ai/edit", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const doc = uiDocumentSchema.safeParse(result.document);
      const patchesValid =
        Array.isArray(result.patches) &&
        result.patches.every((patch) => uiPatchSchema.safeParse(patch).success);
      const changed = JSON.stringify(result.document) !== JSON.stringify(editBase);
      editResults.push({
        ...editCase,
        ok: doc.success && patchesValid && (!editCase.expectChange || changed),
        schemaValid: doc.success,
        patchesValid,
        changed,
        patches: result.patches?.length ?? 0,
        latencyMs: performance.now() - started,
      });
    } catch (e) {
      editResults.push({
        ...editCase,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        latencyMs: performance.now() - started,
      });
    }
  }

  const generated = results.filter((result) => result.ok);
  const mockMode = generated.length > 0 && generated.every((result) => result.mock);
  const latencies = generated.map((result) => result.latencyMs);
  const summary = {
    api: API_URL,
    mode: mockMode ? "mock" : "real-llm",
    generated: {
      total: results.length,
      schemaValid: generated.length,
      uniqueIds: generated.filter((result) => result.uniqueIds).length,
      viewportMatches: generated.filter((result) => result.viewportMatches).length,
      suspicious: generated.filter((result) => result.suspicious).length,
      fallbacks: generated.filter((result) => result.fallback).length,
      avgNodes: generated.length
        ? Math.round(generated.reduce((total, result) => total + result.nodes, 0) / generated.length)
        : 0,
      intentCoverage: generated.length
        ? Math.round(
            (generated.reduce((total, result) => total + result.coverage, 0) / generated.length) * 100,
          )
        : 0,
      latencyMs: {
        avg: latencies.length
          ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length)
          : 0,
        p95: Math.round(percentile(latencies, 95)),
      },
    },
    edits: {
      total: editResults.length,
      valid: editResults.filter((result) => result.ok).length,
    },
  };

  console.log("AI evaluation");
  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  for (const result of results) {
    if (!result.ok) {
      console.log(`  ✗ ${result.id}: ${result.error}`);
      continue;
    }
    console.log(
      `  ✓ ${result.id.padEnd(20)} ${String(result.nodes).padStart(3)} nodes · ` +
        `coverage ${result.covered.length}/${result.expected.length} · ${Math.round(result.latencyMs)}ms` +
        `${result.fallback ? " · FALLBACK" : ""}${result.mock ? " · mock" : ""}`,
    );
  }
  for (const result of editResults) {
    console.log(
      `  ${result.ok ? "✓" : "✗"} edit:${result.id.padEnd(16)} ` +
        `${result.patches ?? 0} patches · ${Math.round(result.latencyMs)}ms` +
        `${result.error ? ` · ${result.error}` : ""}`,
    );
  }

  // Hard requirements: schema/ids/viewport must be perfect; no unsafe markup.
  const structuralOk =
    generated.length === results.length &&
    summary.generated.uniqueIds === results.length &&
    summary.generated.viewportMatches === results.length &&
    summary.generated.suspicious === 0 &&
    summary.edits.valid === editResults.length;

  // Mock mode is allowed (no key), but a real provider must not silently fall
  // back too often.
  const maxFallbackRate = Number(process.env.EVAL_MAX_FALLBACK_RATE ?? 0.2);
  const fallbackRate = results.length ? summary.generated.fallbacks / results.length : 1;
  const fallbackOk = mockMode || fallbackRate <= maxFallbackRate;

  const pass = structuralOk && fallbackOk;
  console.log("");
  console.log(
    `RESULT: ${pass ? "PASS" : "FAIL"} · structural=${structuralOk ? "ok" : "fail"} · ` +
      `fallbackRate=${Math.round(fallbackRate * 100)}% (max ${Math.round(maxFallbackRate * 100)}%)`,
  );

  const outputPath = process.env.EVAL_OUT;
  if (outputPath) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outputPath, JSON.stringify({ summary, results, editResults }, null, 2));
    console.log(`Saved JSON report to ${outputPath}`);
  }

  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
