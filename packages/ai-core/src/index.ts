// ---------------------------------------------------------------------------
// AI Provider abstraction (plan/14) — the kernel of the custom-provider story.
//
//  - AIProviderConfig: user-editable config (apiKey, baseURL, model, type).
//  - ProviderCapabilities: describes what a provider/model can actually do.
//  - AIProviderService: minimal interface the orchestrator depends on.
//  - ModelRouter: picks which model to use per task type.
//
// The API app implements concrete adapters (OpenAI-compatible etc.). The web
// app only ever talks to the backend — never to a provider directly.
// ---------------------------------------------------------------------------

export type ProviderType = "openai" | "anthropic" | "gemini" | "custom";
export type AiTaskType = "UI_GENERATION" | "UI_EDITING" | "IMAGE_UNDERSTANDING" | "DESIGN_ANALYSIS";

export interface ProviderModelConfig {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  textGeneration: boolean;
  vision: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
}

export interface AIProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  apiKey?: string;
  models: ProviderModelConfig[];
  enabled: boolean;
}

/** A normalized message that any provider adapter understands. */
export interface AiRequestMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** When true, the provider should return strict JSON (structured output). */
  jsonMode?: boolean;
  /** Optional image inputs (data URLs) for vision-capable models. */
  images?: string[];
  signal?: AbortSignal;
}

export interface AiChatResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * The single interface every provider adapter implements. The AI Orchestrator
 * (in the api app) depends on this — never on OpenAI/Anthropic directly.
 */
export interface AIProviderService {
  readonly config: AIProviderConfig;
  /** Returns the resolved model id (config default or explicit request). */
  chat(messages: AiRequestMessage[], opts?: AiChatOptions): Promise<AiChatResult>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;
}

/**
 * Task → model routing hints. The api app fills this from user config
 * (ai_routing table in plan/14); the defaults below are reasonable MVP values.
 */
export interface ModelRoute {
  taskType: AiTaskType;
  modelId?: string;
  fallbackModelId?: string;
}

export class ModelRouter {
  constructor(
    private readonly routes: ModelRoute[],
    private readonly provider: AIProviderService,
  ) {}

  /** Resolve the model id to use for a task. Falls back to provider default. */
  resolve(taskType: AiTaskType): string {
    const route = this.routes.find((r) => r.taskType === taskType);
    const available = new Set(this.provider.config.models.map((m) => m.id));
    if (route?.modelId && available.has(route.modelId)) return route.modelId;
    if (route?.fallbackModelId && available.has(route.fallbackModelId)) return route.fallbackModelId;
    return this.provider.config.models[0]?.id ?? "";
  }

  get hasConfiguredModels(): boolean {
    return this.provider.config.models.length > 0;
  }
}
