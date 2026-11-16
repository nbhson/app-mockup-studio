import { Injectable, BadRequestException } from "@nestjs/common";
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
import { MetricsService, type AiUsage } from "../../common/metrics.service";
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
  normalizeHex,
  paletteFromHexList,
  themeFromPalette,
  withThemeRoles,
} from "./design-reference";
import { heuristicMultiPage } from "./multi-page";
import { validateAssetData } from "../assets/asset-validation";

/** Screenshots are often larger than ordinary assets; keep a safe JSON cap. */
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

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

  constructor(
    private readonly openAI: OpenAIProviderService,
    private readonly metrics: MetricsService,
  ) {}

  private get useRealLLM(): boolean {
    return this.openAI.isConfigured;
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const raw = extractJson(result.text);
        const doc = uiDocumentSchema.parse(JSON.parse(raw));
        ensureIdsUnique(doc);
        this.metrics.recordAi(
          "generate",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          document: doc,
          summary: `Đã tạo mockup từ yêu cầu của bạn. Bạn có thể tiếp tục nhắn để chỉnh sửa ngay trong hội thoại này.`,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    // After retries, fall back to a valid mock so the user is never stuck.
    this.metrics.recordAi(
      "generate",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    return {
      document: generateMockDocument(parsed.prompt, (viewportMode ?? "desktop") as never),
      summary: `⚠️ Không thể xác nhận kết quả AI hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng mockup dự phòng.`,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const raw = extractJson(result.text);
        const parsedPatches = JSON.parse(raw) as unknown[];
        if (!Array.isArray(parsedPatches)) throw new Error("Expected an array of patches");
        const patches: UiPatch[] = [];
        for (const candidate of parsedPatches) {
          const patch = uiPatchSchema.parse(candidate);
          validatePatchTargets(patch, parsed.document);
          patches.push(patch as UiPatch);
        }
        const document = applyPatchBatch(parsed.document, patches);
        this.metrics.recordAi("edit", "ok", performance.now() - started, usage, attempts);
        return {
          document,
          patches,
          summary: patches.length
            ? `Đã áp dụng ${patches.length} thay đổi theo yêu cầu của bạn.`
            : "Không có thay đổi nào được áp dụng (không tìm thấy mục tiêu phù hợp).",
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    this.metrics.recordAi("edit", "error", performance.now() - started, usage, attempts);
    throw new BadRequestException(`AI không thể tạo patch hợp lệ: ${lastError}`);
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
    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 3000, temperature: 0.3 },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const raw = extractJson(result.text);
        const response = critiqueResponseSchema.parse(JSON.parse(raw));
        const validIds = new Set(collectIds(parsed.document.root));
        const findings: CritiqueFinding[] = response.findings.map((finding, index) => ({
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
        this.metrics.recordAi(
          "critique",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          score: Math.round(response.score),
          summary: response.summary,
          findings,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "critique",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = heuristicCritique(parsed.document, viewport);
    return {
      ...fallback,
      summary: `⚠️ AI không trả về critique hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ. ${fallback.summary}`,
    };
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
    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 3000, temperature: 0.7 },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const response = dummyDataResponseSchema.parse(
          JSON.parse(extractJson(result.text)),
        );

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

        this.metrics.recordAi(
          "dummy",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          changes,
          summary: response.summary,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "dummy",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = heuristicDummyData(parsed.document, {
      nodeId,
      locale,
      context: parsed.context,
    });
    return {
      ...fallback,
      summary: `⚠️ AI không trả về dữ liệu hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng dữ liệu mẫu cục bộ. ${fallback.summary}`,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 3000, temperature: 0.3 },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const response = responsiveResponseSchema.parse(
          JSON.parse(extractJson(result.text)),
        );

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

        this.metrics.recordAi(
          "responsive",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          suggestions,
          summary: response.summary,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "responsive",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = heuristicResponsiveOptimization(parsed.document, breakpoints);
    return {
      ...fallback,
      summary: `⚠️ AI không trả về gợi ý hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ. ${fallback.summary}`,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 2000, temperature: 0.5 },
        );
        usage.promptTokens = (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const response = componentRecommendResponseSchema.parse(
          JSON.parse(extractJson(result.text)),
        );

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

        this.metrics.recordAi(
          "recommend",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          suggestions,
          summary: response.summary,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "recommend",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = heuristicRecommendations(parsed.document, parsed.prompt ?? "", max);
    return {
      ...fallback,
      summary: `⚠️ AI không trả về gợi ý hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ. ${fallback.summary}`,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 4000, images: [dataUrl] },
        );
        usage.promptTokens =
          (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const document = uiDocumentSchema.parse(
          JSON.parse(extractJson(result.text)),
        );
        ensureIdsUnique(document);
        document.viewport = { width: size.width, height: size.height };

        this.metrics.recordAi(
          "image",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          document,
          summary: `Đã dựng lại giao diện từ ảnh ${size.width}×${size.height} bằng vision model. Tiếp tục chỉnh sửa trực tiếp trên canvas.`,
          source: "ai",
          model: result.model,
          image,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "image",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    return {
      document: buildFallback(),
      summary: `⚠️ AI không trả về mockup hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ từ ảnh.`,
      source: "heuristic",
      image,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 4000, temperature: 0.3 },
        );
        usage.promptTokens =
          (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const document = uiDocumentSchema.parse(
          JSON.parse(extractJson(result.text)),
        );
        ensureIdsUnique(document);
        document.viewport = { width: 1440, height: 900 };

        this.metrics.recordAi(
          "url",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          document,
          summary: `Đã dựng lại bố cục chính của "${site.title}" bằng AI từ nội dung HTML. Tiếp tục chỉnh sửa trực tiếp trên canvas.`,
          source: "ai",
          model: result.model,
          url: page.url,
          site,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "url",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    return {
      document: buildFallback(),
      summary: `⚠️ AI không trả về mockup hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ từ HTML.`,
      source: "heuristic",
      url: page.url,
      site,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 1200, images: [dataUrl] },
        );
        usage.promptTokens =
          (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const response = designReferenceResponseSchema.parse(
          JSON.parse(extractJson(result.text)),
        );

        const colors = response.colors.map((color) => ({
          hex: normalizeHex(color.hex) ?? "#000000",
          share: 1 / response.colors.length,
          role: color.role,
        }));
        const theme = themeFromPalette(colors, {
          fontFamily: response.fontFamily,
          radius: response.radius,
        });

        this.metrics.recordAi(
          "design",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          palette: withThemeRoles(colors, theme),
          theme,
          summary: response.summary,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "design",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = localResult();
    return {
      ...fallback,
      summary: `⚠️ AI không trả về bảng màu hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng phân tích cục bộ. ${fallback.summary}`,
    };
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

    let lastError: string | null = null;
    let attempts = 0;
    const usage: AiUsage = {};

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt += 1) {
      attempts += 1;
      try {
        const result = await this.openAI.chat(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          { jsonMode: true, maxTokens: 6000, temperature: 0.4 },
        );
        usage.promptTokens =
          (usage.promptTokens ?? 0) + (result.usage?.promptTokens ?? 0);
        usage.completionTokens =
          (usage.completionTokens ?? 0) + (result.usage?.completionTokens ?? 0);
        const response = multiPageResponseSchema.parse(
          JSON.parse(extractJson(result.text)),
        );

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

        this.metrics.recordAi(
          "multi",
          "ok",
          performance.now() - started,
          usage,
          attempts,
        );
        return {
          pages,
          theme,
          summary: response.summary,
          source: "ai",
          model: result.model,
        };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    this.metrics.recordAi(
      "multi",
      "fallback",
      performance.now() - started,
      usage,
      attempts,
    );
    const fallback = buildFallback();
    return {
      ...fallback,
      summary: `⚠️ AI không trả về bộ trang hợp lệ sau ${this.MAX_RETRIES + 1} lần (${lastError}). Đã dùng bộ dựng cục bộ. ${fallback.summary}`,
      source: "heuristic",
    };
  }

  testConnection() {
    return this.openAI.testConnection();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJson(text: string): string {
  // The model may wrap JSON in ``` fences — strip them defensively.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text.trim();
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

/** Patch reference validation — reject edits against unknown ids/types early. */
function validatePatchTargets(patch: UiPatch, doc: UiDocument): void {
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
    case "style":
    case "remove":
    case "replace":
      requireId(patch.targetId, "targetId");
      break;
    case "move":
      requireId(patch.targetId, "targetId");
      requireId(patch.newParentId, "newParentId");
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
