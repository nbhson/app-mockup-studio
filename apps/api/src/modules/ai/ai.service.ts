import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { z } from "zod";
import type { AiRequestMessage } from "@ai-mockup-studio/ai-core";
import type {
  GenerateResult,
  AiEditResult,
  GenerateRequestBody,
  AiEditRequestBody,
  DesignCritiqueRequestBody,
  DesignCritiqueResult,
  CritiqueFinding,
  DummyDataRequestBody,
  DummyDataResult,
  DummyDataChange,
  ResponsiveOptimizeRequestBody,
  ResponsiveOptimizeResult,
  ResponsiveSuggestion,
  ComponentRecommendRequestBody,
  ComponentRecommendResult,
  ComponentRecommendation,
  ImageToUiRequestBody,
  ImageToUiResult,
  UrlToUiRequestBody,
  UrlToUiResult,
  DesignReferenceRequestBody,
  DesignReferenceResult,
  MultiPageRequestBody,
  MultiPageResult,
  GeneratedPage,
} from "@ai-mockup-studio/shared-types";
import {
  uiDocumentSchema,
  uiPatchSchema,
  generateRequestSchema,
  aiEditRequestSchema,
  critiqueRequestSchema,
  critiqueResponseSchema,
  dummyDataRequestSchema,
  dummyDataResponseSchema,
  responsiveRequestSchema,
  responsiveResponseSchema,
  componentRecommendRequestSchema,
  componentRecommendResponseSchema,
  imageToUiRequestSchema,
  urlToUiRequestSchema,
  designReferenceRequestSchema,
  designReferenceResponseSchema,
  multiPageRequestSchema,
  multiPageResponseSchema,
} from "@ai-mockup-studio/validators";
import {
  createId,
  collectDistinctTypes,
  collectIds,
  knownComponentTypes,
  componentRegistry,
  walkTree,
  getComponentDefinition,
  type UiDocument,
  type UiPatch,
  type ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  buildEditSystemPrompt,
  buildEditUserPrompt,
  buildCritiqueSystemPrompt,
  buildCritiqueUserPrompt,
  buildDummyDataSystemPrompt,
  buildDummyDataUserPrompt,
  buildResponsiveSystemPrompt,
  buildResponsiveUserPrompt,
  buildRecommendSystemPrompt,
  buildRecommendUserPrompt,
  buildImageToUiSystemPrompt,
  buildImageToUiUserPrompt,
  buildUrlToUiSystemPrompt,
  buildUrlToUiUserPrompt,
  buildDesignReferenceSystemPrompt,
  buildDesignReferenceUserPrompt,
  buildMultiPageSystemPrompt,
  buildMultiPageUserPrompt,
} from "@ai-mockup-studio/ai-prompts";
import { generateMockDocument } from "../../sample-documents";
import {
  MetricsService,
  type AiKind,
  type AiOutcome,
  type AiUsage,
} from "../../common/metrics.service";
import { OpenAIProviderService } from "./providers/openai.provider";
import { heuristicCritique } from "./critique";
import {
  collectDummyTargets,
  heuristicDummyData,
  sanitizeDummyProps,
} from "./dummy-data";
import {
  heuristicResponsiveOptimization,
  sanitizeResponsiveStyles,
} from "./responsive";
import { heuristicRecommendations } from "./recommend";
import { heuristicImageToUi, readImageSize } from "./image-to-ui";
import {
  fetchPublicPage,
  heuristicUrlToUi,
  parseHtmlSnapshot,
} from "./url-to-ui";
import {
  DEFAULT_PALETTE,
  extractPngPalette,
  isPngDecompressionBomb,
  normalizeHex,
  paletteFromHexList,
  themeFromPalette,
  withThemeRoles,
} from "./design-reference";
import { heuristicMultiPage } from "./multi-page";
import { validateAssetData } from "../assets/asset-validation";

/** Screenshots are often larger than ordinary assets; keep a safe JSON cap. */
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Output budget per feature, in tokens. A full page document is ~4–6k tokens
 * of JSON and a 3-page set ~8–10k, so a 4k ceiling truncated multi-page answers
 * (`finish_reason: "length"`), which surfaced as a JSON parse error and then as
 * the "mockup dự phòng" fallback. `AI_MAX_OUTPUT_TOKENS` caps retries.
 */
const MAX_TOKENS = {
  generate: 8_000,
  edit: 4_000,
  critique: 3_000,
  dummy: 3_000,
  responsive: 3_000,
  recommend: 2_000,
  image: 8_000,
  url: 8_000,
  design: 1_200,
  multi: 12_000,
} as const;

/**
 * Wall-clock budget for one user-facing AI call, including retries. A real
 * reasoning model needs ~40–90 s per attempt, so 3 × 90 s meant the browser
 * waited 4+ minutes: the UI looked frozen, the dev proxy eventually dropped
 * the connection and the follow-up `GET /pages` raced against a restart.
 */
const DEFAULT_AI_BUDGET_MS = 180_000;

/** How much of a rejected answer we echo back to the model when repairing. */
const MAX_REPAIR_ECHO_CHARS = 16_000;

/** Why the AI pipeline gave up, so the user-facing message can be honest. */
type AiFailureReason =
  | "timeout"
  | "truncated"
  | "invalid"
  | "unavailable"
  /* Bad key / unknown model / no credit: retrying the same call cannot help. */
  | "provider";

class AiExhaustedError extends Error {
  constructor(
    readonly reason: AiFailureReason,
    readonly attempts: number,
    readonly lastError: string | null,
    readonly usage: AiUsage,
  ) {
    super(lastError ?? "AI call failed");
    this.name = "AiExhaustedError";
  }
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Thinking budget for reasoning models (qwen3, o-series, deepseek-r1).
 *
 * Measured on the same prompt and endpoint: a full page document takes ~30 s
 * at `minimal`, ~45 s at `low` and ~135 s with the provider's default
 * thinking — and every attempt that passes AI_TIMEOUT_MS comes back as the
 * offline mockup. So the studio asks for a bounded effort by default.
 * `AI_REASONING_EFFORT=off` sends nothing (endpoint default); `none` and
 * `false` mean "as little as possible".
 */
function reasoningEffortFromEnv(): "minimal" | "low" | "medium" | "high" | undefined {
  const raw = (process.env.AI_REASONING_EFFORT ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "default") return undefined;
  if (raw === "none" || raw === "false" || raw === "minimal") return "minimal";
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return "low";
}

// ---------------------------------------------------------------------------
// AI Orchestrator (plan/04, plan/09 8.3 AI reliability).
//
// Generation goes through a controlled pipeline:
//   request → schema-generator (LLM or mock) → validator → (retry) → response
// The LLM NEVER returns raw HTML/CSS; it returns a UiDocument (JSON). We
// validate with the `validators` package before trusting the output, and
// retry/fallback instead of ever persisting an invalid document.
// ---------------------------------------------------------------------------

@Injectable()
export class AiService {
  private readonly MAX_RETRIES = 2;
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly openAI: OpenAIProviderService,
    private readonly metrics: MetricsService,
  ) {}

  private get useRealLLM(): boolean {
    return this.openAI.isConfigured;
  }

  /**
   * Provider/parse failures can echo API keys, internal endpoints or raw
   * schema diffs. We log the detail server-side but NEVER put `lastError` in a
   * client response — the user gets a stable Vietnamese message instead.
   */
  private logAiError(
    feature: string,
    attempts: number,
    lastError: string | null,
  ): void {
    this.logger.warn(
      `AI "${feature}" failed after ${attempts} attempt(s): ${lastError ?? "unknown error"}`,
    );
  }

  /**
   * One short Vietnamese sentence that tells the user *what* went wrong, built
   * from our own error categories — never from the provider message, which may
   * carry keys, endpoints or schema internals.
   */
  private failureHint(reason: AiFailureReason): string {
    switch (reason) {
      case "timeout":
        return "Nhà cung cấp AI phản hồi quá chậm (hết thời gian chờ). Thử lại, rút ngắn mô tả, hoặc tăng AI_TIMEOUT_MS nếu bạn dùng model reasoning.";
      case "truncated":
        return "Phản hồi AI bị cắt giữa chừng vì vượt giới hạn độ dài. Thử giảm số trang hoặc rút ngắn mô tả.";
      case "invalid":
        return "Phản hồi AI không đúng cấu trúc yêu cầu.";
      case "unavailable":
        return "Nhà cung cấp AI đang lỗi hoặc quá tải (5xx/429). Thử lại sau ít phút.";
      case "provider":
        return "Nhà cung cấp AI từ chối yêu cầu (kiểm tra OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL).";
    }
  }

  /**
   * The single LLM call path: request → validate → (repair) → result.
   *
   * Retries are *not* identical resends. Each retry gets the rejected answer
   * back plus the concrete reason it was rejected (truncated, bad shape,
   * unknown field), and a truncated answer also raises the output budget. The
   * old loop resent the same prompt up to 3×, so one systemic schema mismatch
   * burned 3 full generations and always landed on the offline fallback.
   *
   * Success is recorded here, so a feature can never count an AI call as
   * "ok" twice or forget to count it at all; failures are recorded by
   * `handleAiFailure` in the caller's catch block.
   */
  private async callValidated<T>(opts: {
    feature: string;
    kind: AiKind;
    started: number;
    system: string;
    user: string;
    validate: (text: string) => T;
    maxTokens?: number;
    temperature?: number;
    images?: string[];
  }): Promise<{ value: T; model: string; usage: AiUsage; attempts: number }> {
    const budgetMs = envPositiveInt("AI_BUDGET_MS", DEFAULT_AI_BUDGET_MS);
    const tokenCap = envPositiveInt("AI_MAX_OUTPUT_TOKENS", 20_000);
    const startedAt = Date.now();
    const usage: AiUsage = {};
    let maxTokens = Math.min(opts.maxTokens ?? 4_000, tokenCap);
    let reason: AiFailureReason = "invalid";
    let lastError: string | null = null;
    let repairNote: string | null = null;
    let previousText: string | null = null;
    let attempts = 0;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      const remainingMs = budgetMs - (Date.now() - startedAt);
      if (attempt > 0 && remainingMs < 5_000) {
        lastError ??= "AI budget exhausted";
        break;
      }
      attempts += 1;

      // Repair turn: show the model exactly what it wrote and why it was
      // rejected. A timeout has no answer to quote, so only the schema/parse
      // failures get the assistant echo.
      const messages: AiRequestMessage[] = [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ];
      if (attempt > 0 && previousText) {
        messages.push({
          role: "assistant",
          content: previousText.slice(0, MAX_REPAIR_ECHO_CHARS),
        });
      }
      if (attempt > 0 && (previousText || repairNote)) {
        messages.push({
          role: "user",
          content: [
            `That answer was rejected: ${repairNote ?? "invalid output"}.`,
            reason === "truncated"
              ? `It stopped mid-JSON because it ran out of tokens. Return a SHORTER document (fewer sections, max ~25 nodes) as minified JSON with no indentation or newlines, and close every brace.`
              : `Fix exactly those problems and return ONLY the corrected JSON — no markdown fences, no commentary.`,
          ].join(" "),
        });
      }

      try {
        const result = await this.openAI.chat(messages, {
          jsonMode: true,
          maxTokens,
          temperature: opts.temperature,
          images: opts.images,
          // Never ask the provider for more time than the caller is already
          // waiting, so the whole action lands inside AI_BUDGET_MS.
          timeoutMs: Math.max(5_000, remainingMs - 2_000),
          reasoningEffort: reasoningEffortFromEnv(),
        });
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);

        // A "length" finish means the JSON is cut off: parsing it would fail
        // with a cryptic syntax error, so report the real cause and give the
        // next attempt more room.
        if (result.finishReason === "length") {
          reason = "truncated";
          lastError = "response truncated at max_tokens";
          repairNote = `your JSON stopped mid-document after ${result.text.length} characters`;
          previousText = result.text;
          maxTokens = Math.min(maxTokens * 2, tokenCap);
          continue;
        }

        const value = opts.validate(result.text);
        this.metrics.recordAi(
          opts.kind,
          "ok",
          performance.now() - opts.started,
          usage,
          attempts,
        );
        return { value, model: result.model, usage, attempts };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        lastError = message;
        reason = classifyAiFailure(message);
        // Auth/billing/model errors never fix themselves on a retry; a
        // truncated or malformed answer gets the repair turn above.
        if (reason === "provider") break;
        if (reason === "timeout") {
          // The provider already spent its whole slice of the budget, and there
          // is no answer to quote back — resend the original request once.
          repairNote = null;
          previousText = null;
          continue;
        }
        repairNote = describeAiError(e);
        previousText = previousTextFor(e) ?? previousText;
      }
    }

    throw new AiExhaustedError(reason, attempts, lastError, usage);
  }

  /** Records a failed AI pipeline run and returns the normalized failure. */
  private handleAiFailure(
    feature: string,
    kind: AiKind,
    started: number,
    error: unknown,
    outcome: AiOutcome,
  ): { failure: AiExhaustedError; attempts: number; hint: string } {
    const message = error instanceof Error ? error.message : String(error);
    const failure =
      error instanceof AiExhaustedError
        ? error
        : new AiExhaustedError(classifyAiFailure(message), 1, message, {});
    this.logAiError(feature, failure.attempts, failure.lastError);
    this.metrics.recordAi(
      kind,
      outcome,
      performance.now() - started,
      failure.usage,
      failure.attempts,
    );
    return {
      failure,
      attempts: Math.max(1, failure.attempts),
      hint: this.failureHint(failure.reason),
    };
  }

  async generate(body: GenerateRequestBody, viewportMode: string | undefined): Promise<GenerateResult> {
    const started = performance.now();
    const parsed = generateRequestSchema.parse(body);
    if (!this.useRealLLM) {
      const document = generateMockDocument(parsed.prompt, (viewportMode ?? "desktop") as never);
      this.metrics.recordAi("generate", "mock", performance.now() - started);
      return {
        document,
        summary: `Đã tạo mockup offline (mock provider). Kết quả mẫu — thiết lập OPENAI_API_KEY để AI sinh giao diện theo đúng yêu cầu.`,
      };
    }

    const viewport =
      viewportMode === "mobile"
        ? { width: 390, height: 844 }
        : viewportMode === "tablet"
          ? { width: 768, height: 1024 }
          : { width: 1440, height: 900 };

    const system = buildGenerationSystemPrompt({
      availableTypes: knownComponentTypes,
      viewport,
      themeName: "neutral",
    });
    const user = buildGenerationUserPrompt(parsed.prompt, { currentThemeName: "neutral" });

    try {
      const { value: doc } = await this.callValidated({
        feature: "generate",
        kind: "generate",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.generate,
        validate: (text) =>
          parseWith(text, (value) => {
            const document = uiDocumentSchema.parse(value);
            ensureIdsUnique(document);
            return document;
          }),
      });
      return {
        document: doc,
        summary: `Đã tạo mockup từ yêu cầu của bạn. Bạn có thể tiếp tục nhắn để chỉnh sửa ngay trong hội thoại này.`,
      };
    } catch (e) {
      // After retries, fall back to a valid mock so the user is never stuck.
      const { attempts, hint } = this.handleAiFailure(
        "generate",
        "generate",
        started,
        e,
        "fallback",
      );
      return {
        document: generateMockDocument(parsed.prompt, (viewportMode ?? "desktop") as never),
        summary: `⚠️ Không thể lấy kết quả AI hợp lệ sau ${attempts} lần. ${hint} Đã dùng mockup dự phòng.`,
      };
    }
  }

  async edit(
    body: AiEditRequestBody,
  ): Promise<AiEditResult> {
    const started = performance.now();
    const parsed = aiEditRequestSchema.parse(body);
    if (!this.useRealLLM) {
      // Offline mock editing: produce a harmless, valid sample edit so the
      // full patch pipeline can be exercised without a model. Unknown targets
      // produce an empty patch list, mirroring the real prompt contract.
      const targetExists =
        !parsed.targetId || collectIds(parsed.document.root).includes(parsed.targetId);
      const patches: UiPatch[] = targetExists
        ? [
            {
              op: "update",
              targetId: parsed.targetId ?? parsed.document.root.id,
              changes: { "props.title": (parsed.prompt || "").slice(0, 24) || "Edited" },
            },
          ]
        : [];
      this.metrics.recordAi("edit", "mock", performance.now() - started);
      return {
        document: applyPatchBatch(parsed.document, patches),
        patches,
        summary: targetExists
          ? "Chỉnh sửa offline (mock). Cấu hình OPENAI_API_KEY để AI hiểu yêu cầu."
          : "Không tìm thấy thành phần cần chỉnh sửa nên không có thay đổi nào.",
      };
    }

    const system = buildEditSystemPrompt(knownComponentTypes);
    const user = buildEditUserPrompt(parsed.prompt, parsed.document, parsed.targetId);

    try {
      const { value } = await this.callValidated({
        feature: "edit",
        kind: "edit",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.edit,
        validate: (text) =>
          parseWith(text, (value_) => {
            if (!Array.isArray(value_)) throw new Error("Expected an array of patches");
            const patches: UiPatch[] = [];
            for (const candidate of value_) {
              const patch = uiPatchSchema.parse(candidate);
              validatePatchTargets(patch, parsed.document);
              patches.push(patch as UiPatch);
            }
            return { patches, document: applyPatchBatch(parsed.document, patches) };
          }),
      });
      return {
        document: value.document,
        patches: value.patches,
        summary: value.patches.length
          ? `Đã áp dụng ${value.patches.length} thay đổi theo yêu cầu của bạn.`
          : "Không có thay đổi nào được áp dụng (không tìm thấy mục tiêu phù hợp).",
      };
    } catch (e) {
      this.handleAiFailure("edit", "edit", started, e, "error");
      throw new BadRequestException(
        "AI không thể tạo patch hợp lệ. Vui lòng mô tả rõ hơn hoặc thử lại.",
      );
    }
  }

  /**
   * Design critique (plan/07 3.5): evaluate the document like a senior designer
   * and return a score + actionable findings. Falls back to the deterministic
   * analyzer so the feature works without an API key.
   */
  async critique(body: DesignCritiqueRequestBody): Promise<DesignCritiqueResult> {
    const started = performance.now();
    const parsed = critiqueRequestSchema.parse(body);
    const viewport = (parsed.viewportMode ?? "desktop") as ViewportMode;

    if (!this.useRealLLM) {
      const result = heuristicCritique(parsed.document, viewport);
      this.metrics.recordAi("critique", "mock", performance.now() - started);
      return result;
    }

    const system = buildCritiqueSystemPrompt();
    const user = buildCritiqueUserPrompt(parsed.document, viewport);

    try {
      const { value, model } = await this.callValidated({
        feature: "critique",
        kind: "critique",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.critique,
        temperature: 0.3,
        validate: (text) =>
          parseWith(text, (value) => critiqueResponseSchema.parse(value)),
      });
      const validIds = new Set(collectIds(parsed.document.root));
      const findings: CritiqueFinding[] = value.findings.map((finding, index) => ({
        id: finding.id ?? `ai-${index + 1}`,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        suggestion: finding.suggestion,
        nodeId:
          finding.nodeId && validIds.has(finding.nodeId) ? finding.nodeId : null,
        fixStyles: sanitizeFixStyles(finding.fixStyles),
      }));
      return {
        score: Math.round(value.score),
        summary: value.summary,
        findings,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "critique",
        "critique",
        started,
        e,
        "fallback",
      );
      const fallback = heuristicCritique(parsed.document, viewport);
      return {
        ...fallback,
        summary: `⚠️ AI không trả về critique hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ. ${fallback.summary}`,
      };
    }
  }

  /**
   * AI dummy data (plan/07 3.7): fill data-bearing components with believable
   * demo content. Works offline through the deterministic generator.
   */
  async generateDummyData(body: DummyDataRequestBody): Promise<DummyDataResult> {
    const started = performance.now();
    const parsed = dummyDataRequestSchema.parse(body);
    const locale = parsed.locale ?? "vi";
    const nodeId = parsed.nodeId ?? null;

    const targets = collectDummyTargets(parsed.document, {
      nodeId,
      locale,
      context: parsed.context,
    });

    if (targets.length === 0) {
      const empty = heuristicDummyData(parsed.document, {
        nodeId,
        locale,
        context: parsed.context,
      });
      this.metrics.recordAi("dummy", "mock", performance.now() - started);
      return empty;
    }

    if (!this.useRealLLM) {
      const result = heuristicDummyData(parsed.document, {
        nodeId,
        locale,
        context: parsed.context,
      });
      this.metrics.recordAi("dummy", "mock", performance.now() - started);
      return result;
    }

    const system = buildDummyDataSystemPrompt({
      locale,
      context: parsed.context,
      targets: targets.map((target) => ({
        nodeId: target.node.id,
        nodeType: target.node.type,
        allowedProps: target.props,
      })),
    });
    const user = buildDummyDataUserPrompt(parsed.document, parsed.context);
    const targetById = new Map(targets.map((target) => [target.node.id, target]));

    try {
      const { value, model } = await this.callValidated({
        feature: "dummy",
        kind: "dummy",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.dummy,
        temperature: 0.7,
        validate: (text) =>
          parseWith(text, (value) => {
            const response = dummyDataResponseSchema.parse(value);
            const changes: DummyDataChange[] = [];
            for (const change of response.changes) {
              const target = targetById.get(change.nodeId);
              if (!target) continue;
              const sanitized = sanitizeDummyProps(target.node.type, change.props);
              if (!sanitized) continue;
              const selected: Record<string, unknown> = {};
              for (const key of target.props) {
                if (sanitized[key] !== undefined) selected[key] = sanitized[key];
              }
              if (Object.keys(selected).length === 0) continue;
              changes.push({
                nodeId: target.node.id,
                nodeType: target.node.type,
                nodeLabel: target.label,
                props: selected,
              });
            }
            if (changes.length === 0) {
              throw new Error("model returned no valid dummy-data changes");
            }
            return { changes, summary: response.summary };
          }),
      });
      return {
        changes: value.changes,
        summary: value.summary,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "dummy",
        "dummy",
        started,
        e,
        "fallback",
      );
      const fallback = heuristicDummyData(parsed.document, {
        nodeId,
        locale,
        context: parsed.context,
      });
      return {
        ...fallback,
        summary: `⚠️ AI không trả về dữ liệu hợp lệ sau ${attempts} lần. ${hint} Đã dùng dữ liệu mẫu cục bộ. ${fallback.summary}`,
      };
    }
  }

  /**
   * AI responsive optimization (plan/07 3.8): propose safe tablet/mobile
   * overrides without touching desktop styles. Works offline.
   */
  async optimizeResponsive(
    body: ResponsiveOptimizeRequestBody,
  ): Promise<ResponsiveOptimizeResult> {
    const started = performance.now();
    const parsed = responsiveRequestSchema.parse(body);
    const breakpoints = parsed.breakpoints ?? ["tablet", "mobile"];

    if (!this.useRealLLM) {
      const result = heuristicResponsiveOptimization(parsed.document, breakpoints);
      this.metrics.recordAi("responsive", "mock", performance.now() - started);
      return result;
    }

    const system = buildResponsiveSystemPrompt(breakpoints);
    const user = buildResponsiveUserPrompt(parsed.document, breakpoints);
    const nodes = new Map<string, { type: string; label: string }>();
    walkTree(parsed.document.root, (node) => {
      nodes.set(node.id, {
        type: node.type,
        label: getComponentDefinition(node.type)?.label ?? node.type,
      });
    });

    try {
      const { value, model } = await this.callValidated({
        feature: "responsive",
        kind: "responsive",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.responsive,
        temperature: 0.3,
        validate: (text) =>
          parseWith(text, (value) => {
            const response = responsiveResponseSchema.parse(value);
            const seen = new Set<string>();
            const suggestions: ResponsiveSuggestion[] = [];
            for (const suggestion of response.suggestions) {
              const node = nodes.get(suggestion.nodeId);
              if (!node) continue;
              if (!breakpoints.includes(suggestion.breakpoint)) continue;
              const key = `${suggestion.breakpoint}:${suggestion.nodeId}`;
              if (seen.has(key)) continue;
              const styles = sanitizeResponsiveStyles(suggestion.styles);
              if (!styles) continue;
              seen.add(key);
              suggestions.push({
                id: `responsive:${suggestion.breakpoint}:${suggestion.nodeId}`,
                nodeId: suggestion.nodeId,
                nodeType: node.type,
                nodeLabel: node.label,
                breakpoint: suggestion.breakpoint,
                title: suggestion.title ?? `Tối ưu ${suggestion.breakpoint}`,
                detail:
                  suggestion.detail ??
                  `AI đề xuất override cho ${node.label} ở breakpoint ${suggestion.breakpoint}.`,
                styles,
              });
            }
            if (suggestions.length === 0) {
              throw new Error("model returned no valid responsive suggestions");
            }
            return { suggestions, summary: response.summary };
          }),
      });
      return {
        suggestions: value.suggestions,
        summary: value.summary,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "responsive",
        "responsive",
        started,
        e,
        "fallback",
      );
      const fallback = heuristicResponsiveOptimization(parsed.document, breakpoints);
      return {
        ...fallback,
        summary: `⚠️ AI không trả về gợi ý hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ. ${fallback.summary}`,
      };
    }
  }

  /**
   * AI component recommendation (plan/07 3.9): suggest the next components to
   * add based on the user's goal and the current document. Works offline.
   */
  async recommendComponents(
    body: ComponentRecommendRequestBody,
  ): Promise<ComponentRecommendResult> {
    const started = performance.now();
    const parsed = componentRecommendRequestSchema.parse(body);
    const max = parsed.max ?? 6;

    if (!this.useRealLLM) {
      const result = heuristicRecommendations(parsed.document, parsed.prompt ?? "", max);
      this.metrics.recordAi("recommend", "mock", performance.now() - started);
      return result;
    }

    const availableTypes = knownComponentTypes.map((type) => {
      const definition = componentRegistry[type];
      return {
        type,
        label: definition.label,
        category: definition.category,
      };
    });
    const system = buildRecommendSystemPrompt({
      availableTypes,
      prompt: parsed.prompt,
    });
    const user = buildRecommendUserPrompt(parsed.document, parsed.prompt);

    try {
      const { value, model } = await this.callValidated({
        feature: "recommend",
        kind: "recommend",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.recommend,
        temperature: 0.5,
        validate: (text) =>
          parseWith(text, (value) => {
            const response = componentRecommendResponseSchema.parse(value);
            const seen = new Set<string>();
            const suggestions: ComponentRecommendation[] = [];
            for (const suggestion of response.suggestions) {
              if (!knownComponentTypes.includes(suggestion.type)) continue;
              if (seen.has(suggestion.type)) continue;
              seen.add(suggestion.type);
              const definition = componentRegistry[suggestion.type];
              suggestions.push({
                type: suggestion.type,
                label: definition.label,
                category: definition.category,
                reason: suggestion.reason,
                score: Math.max(0, Math.min(100, Math.round(suggestion.score ?? 60))),
              });
              if (suggestions.length >= max) break;
            }
            if (suggestions.length === 0) {
              throw new Error("model returned no valid component recommendations");
            }
            return { suggestions, summary: response.summary };
          }),
      });
      return {
        suggestions: value.suggestions,
        summary: value.summary,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "recommend",
        "recommend",
        started,
        e,
        "fallback",
      );
      const fallback = heuristicRecommendations(parsed.document, parsed.prompt ?? "", max);
      return {
        ...fallback,
        summary: `⚠️ AI không trả về gợi ý hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ. ${fallback.summary}`,
      };
    }
  }

  /**
   * Image-to-UI (plan/07 3.1): recreate a screenshot as an editable document.
   * Uses the vision model when configured and always falls back to a local
   * heuristic so the feature works offline.
   */
  async imageToUi(body: ImageToUiRequestBody): Promise<ImageToUiResult> {
    const started = performance.now();
    const parsed = imageToUiRequestSchema.parse(body);
    const data = validateAssetData(
      parsed.imageBase64,
      parsed.mimeType,
      MAX_AI_IMAGE_BYTES,
    );
    const size = readImageSize(data, parsed.mimeType) ?? { width: 1440, height: 900 };
    const image = {
      width: size.width,
      height: size.height,
      mimeType: parsed.mimeType,
    };
    const buildFallback = () =>
      heuristicImageToUi({
        width: size.width,
        height: size.height,
        mimeType: parsed.mimeType,
        prompt: parsed.prompt,
        viewport: parsed.viewport,
      });

    if (!this.useRealLLM) {
      const document = buildFallback();
      this.metrics.recordAi("image", "mock", performance.now() - started);
      return {
        document,
        summary: `Đã dựng mockup từ ảnh ${size.width}×${size.height} bằng phân tích cục bộ. Cài OPENAI_API_KEY để dùng vision model và bám sát ảnh gốc hơn.`,
        source: "heuristic",
        image,
      };
    }

    const ratio = size.height > 0 ? size.width / size.height : 1.6;
    const viewport =
      parsed.viewport ??
      (ratio >= 1.35 ? "desktop" : ratio <= 0.85 ? "mobile" : "tablet");
    const system = buildImageToUiSystemPrompt({
      availableTypes: knownComponentTypes,
      width: size.width,
      height: size.height,
      viewport,
    });
    const user = buildImageToUiUserPrompt(parsed.prompt);
    const dataUrl = `data:${parsed.mimeType};base64,${parsed.imageBase64.replace(
      /^data:[^;]+;base64,/,
      "",
    )}`;

    try {
      const { value: document, model } = await this.callValidated({
        feature: "image",
        kind: "image",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.image,
        images: [dataUrl],
        validate: (text) =>
          parseWith(text, (value) => {
            const document = uiDocumentSchema.parse(value);
            ensureIdsUnique(document);
            document.viewport = { width: size.width, height: size.height };
            return document;
          }),
      });
      return {
        document,
        summary: `Đã dựng lại giao diện từ ảnh ${size.width}×${size.height} bằng vision model. Tiếp tục chỉnh sửa trực tiếp trên canvas.`,
        source: "ai",
        model,
        image,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "image",
        "image",
        started,
        e,
        "fallback",
      );
      return {
        document: buildFallback(),
        summary: `⚠️ AI không trả về mockup hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ từ ảnh.`,
        source: "heuristic",
        image,
      };
    }
  }

  /**
   * URL-to-UI (plan/07 3.2): fetch a public HTML page safely and recreate its
   * main layout. Works with static HTML; JavaScript-rendered content is
   * approximated from the server-rendered markup.
   */
  async urlToUi(body: UrlToUiRequestBody): Promise<UrlToUiResult> {
    const started = performance.now();
    const parsed = urlToUiRequestSchema.parse(body);
    const page = await fetchPublicPage(parsed.url);
    const snapshot = parseHtmlSnapshot(page.html, page.url);
    const site = {
      title: snapshot.title || new URL(page.url).hostname,
      description: snapshot.description,
      image: snapshot.images[0],
    };
    const buildFallback = () => heuristicUrlToUi(snapshot, page.url, parsed.prompt);

    if (!this.useRealLLM) {
      const document = buildFallback();
      this.metrics.recordAi("url", "mock", performance.now() - started);
      return {
        document,
        summary: `Đã dựng lại bố cục chính của "${site.title}" từ HTML tĩnh bằng phân tích cục bộ. Trang dùng JavaScript động có thể chưa hiển thị đầy đủ.`,
        source: "heuristic",
        url: page.url,
        site,
      };
    }

    const system = buildUrlToUiSystemPrompt({
      availableTypes: knownComponentTypes,
      url: page.url,
    });
    const user = buildUrlToUiUserPrompt(snapshot, parsed.prompt);

    try {
      const { value: document, model } = await this.callValidated({
        feature: "url",
        kind: "url",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.url,
        temperature: 0.3,
        validate: (text) =>
          parseWith(text, (value) => {
            const doc = uiDocumentSchema.parse(value);
            ensureIdsUnique(doc);
            doc.viewport = { width: 1440, height: 900 };
            return doc;
          }),
      });
      return {
        document,
        summary: `Đã dựng lại bố cục chính của "${site.title}" bằng AI từ nội dung HTML. Tiếp tục chỉnh sửa trực tiếp trên canvas.`,
        source: "ai",
        model,
        url: page.url,
        site,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "url",
        "url",
        started,
        e,
        "fallback",
      );
      return {
        document: buildFallback(),
        summary: `⚠️ AI không trả về mockup hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ từ HTML.`,
        source: "heuristic",
        url: page.url,
        site,
      };
    }
  }

  /**
   * Design reference (plan/07 3.3): extract a palette from a reference image
   * and map it to theme tokens. PNGs are decoded locally; JPEG/WebP can use a
   * palette extracted by the web canvas. A vision model can refine the result.
   */
  async designReference(
    body: DesignReferenceRequestBody,
  ): Promise<DesignReferenceResult> {
    const started = performance.now();
    const parsed = designReferenceRequestSchema.parse(body);
    const data = validateAssetData(
      parsed.imageBase64,
      parsed.mimeType,
      MAX_AI_IMAGE_BYTES,
    );

    // A PNG whose IHDR claims unsafe dimensions would decompress into a huge
    // buffer; reject it up front with a clean 400 instead of falling back.
    if (parsed.mimeType === "image/png" && isPngDecompressionBomb(data)) {
      throw new BadRequestException(
        "Ảnh có kích thước giải nén quá lớn và bị chặn để bảo vệ server",
      );
    }

    const clientPalette = parsed.palette ? paletteFromHexList(parsed.palette) : [];
    const localColors =
      clientPalette.length > 0
        ? clientPalette
        : (extractPngPalette(data) ?? DEFAULT_PALETTE);
    const localTheme = themeFromPalette(localColors);
    const localResult = (): DesignReferenceResult => ({
      palette: withThemeRoles(localColors, localTheme),
      theme: localTheme,
      summary:
        "Đã trích bảng màu chủ đạo từ ảnh mẫu và ánh xạ thành design tokens. Bạn có thể chỉnh từng màu trước khi áp dụng.",
      source: "heuristic",
    });

    if (!this.useRealLLM) {
      this.metrics.recordAi("design", "mock", performance.now() - started);
      return localResult();
    }

    const dataUrl = `data:${parsed.mimeType};base64,${parsed.imageBase64.replace(
      /^data:[^;]+;base64,/,
      "",
    )}`;
    const system = buildDesignReferenceSystemPrompt();
    const user = buildDesignReferenceUserPrompt();

    try {
      const { value, model } = await this.callValidated({
        feature: "design",
        kind: "design",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.design,
        images: [dataUrl],
        validate: (text) =>
          parseWith(text, (value_) => {
            const response = designReferenceResponseSchema.parse(value_);
            const colors = response.colors.map((color) => ({
              hex: normalizeHex(color.hex) ?? "#000000",
              share: 1 / response.colors.length,
              role: color.role,
            }));
            const theme = themeFromPalette(colors, {
              fontFamily: response.fontFamily,
              radius: response.radius,
            });
            return { response, colors, theme };
          }),
      });
      return {
        palette: withThemeRoles(value.colors, value.theme),
        theme: value.theme,
        summary: value.response.summary,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "design",
        "design",
        started,
        e,
        "fallback",
      );
      const fallback = localResult();
      return {
        ...fallback,
        summary: `⚠️ AI không trả về bảng màu hợp lệ sau ${attempts} lần. ${hint} Đã dùng phân tích cục bộ. ${fallback.summary}`,
      };
    }
  }

  /**
   * Multi-page generation (plan/07 3.4): one prompt → several linked pages
   * sharing a theme. Works offline with the deterministic builder.
   */
  async generateMultiPage(body: MultiPageRequestBody): Promise<MultiPageResult> {
    const started = performance.now();
    const parsed = multiPageRequestSchema.parse(body);
    const pageCount = parsed.pageCount ?? 3;
    const viewportMode = parsed.viewportMode ?? "desktop";
    const viewport =
      viewportMode === "mobile"
        ? { width: 390, height: 844 }
        : viewportMode === "tablet"
          ? { width: 768, height: 1024 }
          : { width: 1440, height: 900 };
    const buildFallback = () =>
      heuristicMultiPage({ prompt: parsed.prompt, pageCount, viewportMode });

    if (!this.useRealLLM) {
      const fallback = buildFallback();
      this.metrics.recordAi("multi", "mock", performance.now() - started);
      return { ...fallback, source: "heuristic" };
    }

    const system = buildMultiPageSystemPrompt({
      availableTypes: knownComponentTypes,
      pageCount,
      viewport,
      themeName: "neutral",
    });
    const user = buildMultiPageUserPrompt(parsed.prompt);

    try {
      const { value, model } = await this.callValidated({
        feature: "multi",
        kind: "multi",
        started,
        system,
        user,
        maxTokens: MAX_TOKENS.multi,
        temperature: 0.4,
        validate: (text) =>
          parseWith(text, (value_) => {
            const response = multiPageResponseSchema.parse(value_);
            const theme = response.pages[0].document.theme;
            const usedSlugs = new Set<string>();
            const pages: GeneratedPage[] = response.pages.map((page, index) => {
              let slug = page.slug;
              if (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
              while (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
              usedSlugs.add(slug);

              ensureIdsUnique(page.document);
              page.document.pageId = createId("page");
              page.document.name = page.name;
              page.document.theme = { ...theme };
              page.document.viewport = viewport;
              return { name: page.name, slug, document: page.document };
            });
            return { pages, theme, summary: response.summary };
          }),
      });
      return {
        pages: value.pages,
        theme: value.theme,
        summary: value.summary,
        source: "ai",
        model,
      };
    } catch (e) {
      const { attempts, hint } = this.handleAiFailure(
        "multi",
        "multi",
        started,
        e,
        "fallback",
      );
      const fallback = buildFallback();
      return {
        ...fallback,
        summary: `⚠️ AI không trả về bộ trang hợp lệ sau ${attempts} lần. ${hint} Đã dùng bộ dựng cục bộ. ${fallback.summary}`,
        source: "heuristic",
      };
    }
  }

  testConnection() {
    return this.openAI.testConnection();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a thrown error onto our own failure category. Provider messages are
 * matched but never forwarded to the client, so an API key inside one cannot
 * leak into a response.
 */
function classifyAiFailure(message: string): AiFailureReason {
  if (/timeout|abort/i.test(message)) return "timeout";
  if (/truncated at max_tokens/i.test(message)) return "truncated";
  const status = /(?:OpenAI (?:error|HTTP)|status|HTTP)\D{0,3}(\d{3})/.exec(message)?.[1];
  // 401/402/403/404 = bad key, no credit, unknown model. Retrying the exact
  // same request cannot help, so the loop stops and the user gets the hint.
  if (status && ["401", "402", "403", "404"].includes(status)) return "provider";
  if (status && (/^5\d\d$/.test(status) || status === "429" || status === "408")) {
    return "unavailable";
  }
  return "invalid";
}

/**
 * Short, model-readable description of a rejected answer. A raw ZodError
 * dumps the whole expected schema (~4 kB) which doubles the repair prompt for
 * no gain, so only the offending paths are quoted.
 */
function describeAiError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    const more = error.issues.length - issues.length;
    return `${error.issues.length} schema error(s) — ${issues.join("; ")}${more > 0 ? `; (+${more} more)` : ""}. Required top-level keys are the ones in the contract.`;
  }
  if (error instanceof SyntaxError) {
    return `The JSON is malformed or incomplete (${error.message}). Return one complete JSON value.`;
  }
  return String(error instanceof Error ? error.message : error).slice(0, 200);
}

/** The rejected text, when the error carries it, so the next turn can repair it. */
function previousTextFor(error: unknown): string | null {
  const text = (error as { aiText?: unknown })?.aiText;
  return typeof text === "string" ? text : null;
}

/** Parses + validates provider text and tags failures with the raw answer. */
function parseWith<T>(text: string, run: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch (e) {
    throw Object.assign(new SyntaxError(describeAiError(e)), { aiText: text });
  }
  try {
    return run(value);
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { aiText: text });
  }
}

function extractJson(text: string): string {
  // The model may wrap JSON in ``` fences — strip them defensively.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith("{") || body.startsWith("[")) return body;
  // Some providers prepend a sentence ("Sure! Here is the document: {…}").
  // Cutting to the outermost JSON value rescues those instead of burning a
  // whole retry on a parse error.
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return body;
}

/** Ensure ids are unique; regenerate duplicates to avoid patch ambiguity. */
function ensureIdsUnique(doc: UiDocument): void {
  const seen = new Set<string>();
  const visit = (node: (typeof doc.root)) => {
    if (seen.has(node.id)) node.id = createId("node");
    seen.add(node.id);
    node.children?.forEach(visit);
  };
  visit(doc.root);
}

/**
 * First path segments a model may NEVER write through an update patch's
 * `changes`. The `props.*` / `styles.*` / `responsive.*` / `name` / `hidden` /
 * `locked` / `text` prefixes are the only sanctioned targets; anything that
 * could reach an object's prototype chain (`__proto__`, `constructor`,
 * `prototype`) or a structural node field (`id`, `type`, `children`) is
 * rejected here so a malicious or hallucinated patch fails with a clean 400 /
 * retry instead of polluting shared prototypes or corrupting the tree mid-apply.
 */
const FORBIDDEN_CHANGE_ROOTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "id",
  "type",
  "children",
]);

/** True when any dotted `changes` key resolves to a forbidden root segment. */
function hasForbiddenChangeKey(changes: Record<string, unknown>): boolean {
  return Object.keys(changes).some((key) =>
    FORBIDDEN_CHANGE_ROOTS.has(key.split(".")[0]),
  );
}

/**
 * Patch reference validation — reject edits against unknown ids/types early.
 * Exported for unit tests; only called from `edit` in production code.
 */
export function validatePatchTargets(patch: UiPatch, doc: UiDocument): void {
  const validIds = new Set(collectIds(doc.root));
  const validTypes = new Set(collectDistinctTypes(doc.root));

  const requireId = (id: string | undefined, what: string) => {
    if (!id || !validIds.has(id)) throw new Error(`Patch references unknown ${what} "${id}"`);
  };

  switch (patch.op) {
    case "add":
      requireId(patch.parentId, "parentId");
      if (!knownComponentTypes.includes(patch.node.type)) {
        throw new Error(`Unknown component type "${patch.node.type}"`);
      }
      break;
    case "update":
      requireId(patch.targetId, "targetId");
      if (hasForbiddenChangeKey(patch.changes)) {
        throw new Error("Patch contains a disallowed change key");
      }
      break;
    case "style":
    case "remove":
    case "replace":
      requireId(patch.targetId, "targetId");
      break;
    case "move":
      requireId(patch.targetId, "targetId");
      requireId(patch.newParentId, "newParentId");
      if (patch.newParentId === patch.targetId) {
        throw new Error("Cannot move a component into itself");
      }
      break;
  }
  void validTypes;
}

/**
 * Only allow known UiStyles keys with primitive values, so a model can never
 * inject arbitrary style objects into the document through a critique fix.
 */
const ALLOWED_FIX_STYLE_KEYS = new Set([
  "width",
  "height",
  "minWidth",
  "minHeight",
  "padding",
  "margin",
  "gap",
  "display",
  "flex",
  "flexDirection",
  "flexWrap",
  "flexShrink",
  "alignItems",
  "justifyContent",
  "backgroundColor",
  "color",
  "fontSize",
  "fontWeight",
  "borderWidth",
  "borderColor",
  "borderRadius",
  "opacity",
]);

function sanitizeFixStyles(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const styles: Record<string, unknown> = {};
  for (const [key, styleValue] of Object.entries(value)) {
    if (!ALLOWED_FIX_STYLE_KEYS.has(key)) continue;
    if (typeof styleValue === "string") styles[key] = styleValue;
    else if (typeof styleValue === "number" && Number.isFinite(styleValue)) {
      styles[key] = styleValue;
    }
  }
  return Object.keys(styles).length > 0 ? styles : null;
}
