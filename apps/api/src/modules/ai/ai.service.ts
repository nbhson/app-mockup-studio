import { Injectable, BadRequestException } from "@nestjs/common";
import type {
  GenerateResult,
  AiEditResult,
  GenerateRequestBody,
  AiEditRequestBody,
} from "@ai-mockup-studio/shared-types";
import {
  uiDocumentSchema,
  uiPatchSchema,
  generateRequestSchema,
  aiEditRequestSchema,
} from "@ai-mockup-studio/validators";
import {
  createId,
  collectDistinctTypes,
  collectIds,
  knownComponentTypes,
  type UiDocument,
  type UiPatch,
} from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  buildEditSystemPrompt,
  buildEditUserPrompt,
} from "@ai-mockup-studio/ai-prompts";
import { generateMockDocument } from "../../sample-documents";
import { MetricsService, type AiUsage } from "../../common/metrics.service";
import { OpenAIProviderService } from "./providers/openai.provider";

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
