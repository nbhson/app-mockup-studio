import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MetricsService } from "./metrics.service";

const THRESHOLD_KEYS = [
  "METRICS_ERROR_RATE_THRESHOLD",
  "METRICS_P95_MS_THRESHOLD",
  "METRICS_AI_FALLBACK_THRESHOLD",
] as const;

describe("MetricsService", () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of THRESHOLD_KEYS) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of THRESHOLD_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it("aggregates requests, statuses, routes and latency percentiles", () => {
    process.env.METRICS_ERROR_RATE_THRESHOLD = "0.5";
    const metrics = new MetricsService();
    metrics.recordRequest("GET", "/api/projects", 200, 10);
    metrics.recordRequest("GET", "/api/projects", 200, 20);
    metrics.recordRequest("POST", "/api/projects", 500, 30);

    const snapshot = metrics.snapshot();

    expect(snapshot.requests.total).toBe(3);
    expect(snapshot.requests.errors).toBe(1);
    expect(snapshot.requests.byStatus).toEqual({ "200": 2, "500": 1 });
    expect(snapshot.requests.byMethod).toEqual({ GET: 2, POST: 1 });
    expect(snapshot.routes[0]).toMatchObject({
      method: "GET",
      route: "/api/projects",
      count: 2,
      errors: 0,
      totalMs: 30,
      maxMs: 20,
    });
    expect(snapshot.latencyMs).toMatchObject({
      samples: 3,
      avg: 20,
      p50: 20,
      p95: 30,
      p99: 30,
      max: 30,
    });
    expect(snapshot.alerts).toEqual([]);
  });

  it("tracks AI outcomes, retries and token usage", () => {
    const metrics = new MetricsService();
    metrics.recordAi("generate", "ok", 120, { promptTokens: 10, completionTokens: 20 }, 2);
    metrics.recordAi("generate", "fallback", 30);
    metrics.recordAi("edit", "mock", 40, { promptTokens: 5 });
    metrics.recordAi("critique", "mock", 15);
    metrics.recordAi("dummy", "mock", 12);
    metrics.recordAi("responsive", "mock", 18);
    metrics.recordAi("recommend", "mock", 22);
    metrics.recordAi("image", "mock", 25);
    metrics.recordAi("url", "mock", 28);
    metrics.recordAi("design", "mock", 31);
    metrics.recordAi("multi", "mock", 34);

    const snapshot = metrics.snapshot();

    expect(snapshot.ai.generate).toMatchObject({
      requests: 2,
      byOutcome: { ok: 1, mock: 0, fallback: 1, error: 0 },
      retries: 1,
      totalMs: 150,
      promptTokens: 10,
      completionTokens: 20,
    });
    expect(snapshot.ai.edit).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      promptTokens: 5,
      completionTokens: 0,
    });
    expect(snapshot.ai.critique).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 15,
    });
    expect(snapshot.ai.dummy).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 12,
    });
    expect(snapshot.ai.responsive).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 18,
    });
    expect(snapshot.ai.recommend).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 22,
    });
    expect(snapshot.ai.image).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 25,
    });
    expect(snapshot.ai.url).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 28,
    });
    expect(snapshot.ai.design).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 31,
    });
    expect(snapshot.ai.multi).toMatchObject({
      requests: 1,
      byOutcome: { ok: 0, mock: 1, fallback: 0, error: 0 },
      totalMs: 34,
    });
  });

  it("raises alerts when error rate, p95 or AI fallback cross thresholds", () => {
    process.env.METRICS_ERROR_RATE_THRESHOLD = "0.1";
    process.env.METRICS_P95_MS_THRESHOLD = "1";
    process.env.METRICS_AI_FALLBACK_THRESHOLD = "0.1";

    const metrics = new MetricsService();
    for (let index = 0; index < 8; index += 1) {
      metrics.recordRequest("GET", "/api/projects", 200, 10);
    }
    metrics.recordRequest("GET", "/api/projects", 500, 10);
    metrics.recordRequest("POST", "/api/ai/generate", 500, 10);

    for (let index = 0; index < 4; index += 1) {
      metrics.recordAi("generate", "ok", 10);
    }
    metrics.recordAi("generate", "fallback", 10);

    const snapshot = metrics.snapshot();

    expect(snapshot.alerts).toHaveLength(3);
    expect(snapshot.alerts[0]).toContain("error_rate 20.0% > 10%");
    expect(snapshot.alerts[1]).toContain("latency_p95 10ms > 1ms");
    expect(snapshot.alerts[2]).toContain("ai_fallback_rate 20.0% > 10%");
  });

  it("does not raise alerts for a healthy window", () => {
    const metrics = new MetricsService();
    for (let index = 0; index < 10; index += 1) {
      metrics.recordRequest("GET", "/api/projects", 200, 5);
    }
    for (let index = 0; index < 5; index += 1) {
      metrics.recordAi("generate", "ok", 5);
    }

    expect(metrics.snapshot().alerts).toEqual([]);
  });
});
