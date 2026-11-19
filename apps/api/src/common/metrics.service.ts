import { Injectable } from "@nestjs/common";

// ---------------------------------------------------------------------------
// In-process observability (plan/12 GĐ 6.4).
//
// A dependency-free metrics registry is enough for a single-instance MVP:
// request counts/latency per route plus AI call/token usage. A production
// multi-instance deployment should export the same snapshot to Prometheus /
// OpenTelemetry instead of keeping it in memory.
// ---------------------------------------------------------------------------

export type AiKind =
  | "generate"
  | "edit"
  | "critique"
  | "dummy"
  | "responsive"
  | "recommend"
  | "image"
  | "url"
  | "design"
  | "multi";
export type AiOutcome = "ok" | "mock" | "fallback" | "error";
export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

export interface RouteMetric {
  method: string;
  route: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export interface AiMetric {
  requests: number;
  byOutcome: Record<AiOutcome, number>;
  retries: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  requests: {
    total: number;
    byStatus: Record<string, number>;
    byMethod: Record<string, number>;
    errors: number;
  };
  latencyMs: {
    samples: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  routes: RouteMetric[];
  ai: Record<AiKind, AiMetric>;
  /** Human-readable threshold violations for simple alerting/dashboards. */
  alerts: string[];
}

const MAX_LATENCY_SAMPLES = 2048;
const MAX_ROUTES = 200;
const MAX_METHODS = 32;

function emptyAiMetric(): AiMetric {
  return {
    requests: 0,
    byOutcome: { ok: 0, mock: 0, fallback: 0, error: 0 },
    retries: 0,
    totalMs: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

@Injectable()
export class MetricsService {
  private readonly startedAt = new Date();
  private totalRequests = 0;
  private readonly byStatus = new Map<number, number>();
  private readonly byMethod = new Map<string, number>();
  private readonly routes = new Map<string, RouteMetric>();
  private readonly latencySamples: number[] = [];
  private readonly ai: Record<AiKind, AiMetric> = {
    generate: emptyAiMetric(),
    edit: emptyAiMetric(),
    critique: emptyAiMetric(),
    dummy: emptyAiMetric(),
    responsive: emptyAiMetric(),
    recommend: emptyAiMetric(),
    image: emptyAiMetric(),
    url: emptyAiMetric(),
    design: emptyAiMetric(),
    multi: emptyAiMetric(),
  };

  recordRequest(method: string, route: string, status: number, durationMs: number): void {
    this.totalRequests += 1;
    this.byStatus.set(status, (this.byStatus.get(status) ?? 0) + 1);
    // Cap the method/route cardinality: attacker-controlled methods and
    // unmatched paths must not grow these maps without bound.
    let methodToken = method;
    if (!this.byMethod.has(methodToken) && this.byMethod.size >= MAX_METHODS) {
      methodToken = "OTHER";
    }
    this.byMethod.set(methodToken, (this.byMethod.get(methodToken) ?? 0) + 1);

    let key = `${methodToken} ${route}`;
    if (!this.routes.has(key) && this.routes.size >= MAX_ROUTES) {
      key = `${methodToken} :other`;
    }
    const metric = this.routes.get(key) ?? {
      method,
      route,
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
    };
    metric.count += 1;
    metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    if (status >= 500) metric.errors += 1;
    this.routes.set(key, metric);

    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
  }

  recordAi(
    kind: AiKind,
    outcome: AiOutcome,
    durationMs: number,
    usage: AiUsage = {},
    attempts = 1,
  ): void {
    const metric = this.ai[kind];
    metric.requests += 1;
    metric.byOutcome[outcome] += 1;
    metric.totalMs += durationMs;
    metric.retries += Math.max(0, attempts - 1);
    metric.promptTokens += usage.promptTokens ?? 0;
    metric.completionTokens += usage.completionTokens ?? 0;
  }

  snapshot(): MetricsSnapshot {
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    const totalErrors = [...this.byStatus.entries()]
      .filter(([status]) => status >= 500)
      .reduce((total, [, count]) => total + count, 0);
    const p95 = round(percentile(sorted, 95));
    const alerts: string[] = [];

    if (this.totalRequests > 0) {
      const errorRate = totalErrors / this.totalRequests;
      const maxErrorRate = envNumber("METRICS_ERROR_RATE_THRESHOLD", 0.05);
      if (errorRate > maxErrorRate) {
        alerts.push(
          `error_rate ${(errorRate * 100).toFixed(1)}% > ${(maxErrorRate * 100).toFixed(0)}%`,
        );
      }
    }

    const maxP95 = envNumber("METRICS_P95_MS_THRESHOLD", 1000);
    if (sorted.length >= 10 && p95 > maxP95) {
      alerts.push(`latency_p95 ${p95}ms > ${maxP95}ms`);
    }

    const aiRequests =
      this.ai.generate.requests +
      this.ai.edit.requests +
      this.ai.critique.requests +
      this.ai.dummy.requests +
      this.ai.responsive.requests +
      this.ai.recommend.requests +
      this.ai.image.requests +
      this.ai.url.requests +
      this.ai.design.requests +
      this.ai.multi.requests;
    const aiFallbacks =
      this.ai.generate.byOutcome.fallback +
      this.ai.edit.byOutcome.fallback +
      this.ai.critique.byOutcome.fallback +
      this.ai.dummy.byOutcome.fallback +
      this.ai.responsive.byOutcome.fallback +
      this.ai.recommend.byOutcome.fallback +
      this.ai.image.byOutcome.fallback +
      this.ai.url.byOutcome.fallback +
      this.ai.design.byOutcome.fallback +
      this.ai.multi.byOutcome.fallback;
    if (aiRequests >= 5) {
      const fallbackRate = aiFallbacks / aiRequests;
      const maxFallbackRate = envNumber("METRICS_AI_FALLBACK_THRESHOLD", 0.2);
      if (fallbackRate > maxFallbackRate) {
        alerts.push(
          `ai_fallback_rate ${(fallbackRate * 100).toFixed(1)}% > ${(maxFallbackRate * 100).toFixed(0)}%`,
        );
      }
    }

    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      requests: {
        total: this.totalRequests,
        byStatus: Object.fromEntries(
          [...this.byStatus.entries()]
            .sort(([a], [b]) => a - b)
            .map(([status, count]) => [String(status), count]),
        ),
        byMethod: Object.fromEntries(this.byMethod),
        errors: totalErrors,
      },
      latencyMs: {
        samples: sorted.length,
        avg: sorted.length ? round(sum / sorted.length) : 0,
        p50: round(percentile(sorted, 50)),
        p95,
        p99: round(percentile(sorted, 99)),
        max: round(sorted.length ? sorted[sorted.length - 1] : 0),
      },
      routes: [...this.routes.values()]
        .sort((a, b) => b.count - a.count)
        .map((metric) => ({
          ...metric,
          totalMs: round(metric.totalMs),
          maxMs: round(metric.maxMs),
        })),
      ai: {
        generate: { ...this.ai.generate, totalMs: round(this.ai.generate.totalMs) },
        edit: { ...this.ai.edit, totalMs: round(this.ai.edit.totalMs) },
        critique: { ...this.ai.critique, totalMs: round(this.ai.critique.totalMs) },
        dummy: { ...this.ai.dummy, totalMs: round(this.ai.dummy.totalMs) },
        responsive: { ...this.ai.responsive, totalMs: round(this.ai.responsive.totalMs) },
        recommend: { ...this.ai.recommend, totalMs: round(this.ai.recommend.totalMs) },
        image: { ...this.ai.image, totalMs: round(this.ai.image.totalMs) },
        url: { ...this.ai.url, totalMs: round(this.ai.url.totalMs) },
        design: { ...this.ai.design, totalMs: round(this.ai.design.totalMs) },
        multi: { ...this.ai.multi, totalMs: round(this.ai.multi.totalMs) },
      },
      alerts,
    };
  }
}
