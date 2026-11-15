import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  AIProviderConfig,
  AIProviderService,
  AiChatOptions,
  AiChatResult,
  AiRequestMessage,
  ProviderModelConfig,
} from "@ai-mockup-studio/ai-core";

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter (plan/14). Used when OPENAI_API_KEY is set.
// Any OpenAI-compatible endpoint works (OpenAI, local llama.cpp, LiteLLM,
// OpenRouter, vLLM...) via OPENAI_BASE_URL.
// ---------------------------------------------------------------------------

@Injectable()
export class OpenAIProviderService implements AIProviderService {
  private readonly logger = new Logger(OpenAIProviderService.name);
  readonly config: AIProviderConfig;

  constructor(private readonly configService: ConfigService) {
    const baseURL = (this.configService.get<string>("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    const model = this.configService.get<string>("OPENAI_MODEL") ?? "gpt-4o-mini";
    this.config = {
      id: "openai-compatible",
      name: "OpenAI-compatible",
      type: "custom",
      baseURL,
      apiKey: apiKey ?? undefined,
      enabled: Boolean(apiKey),
      models: [
        {
          id: model,
          name: model,
          capabilities: {
            textGeneration: true,
            vision: true,
            streaming: true,
            structuredOutput: true,
            toolCalling: true,
          },
        },
      ],
    };
  }

  get isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async chat(messages: AiRequestMessage[], opts?: AiChatOptions): Promise<AiChatResult> {
    if (!this.config.apiKey) {
      throw new Error("OpenAI API key not configured");
    }
    const url = `${this.config.baseURL}/chat/completions`;
    const responseFormat = opts?.jsonMode ? { type: "json_object" } as const : undefined;

    // Vision models expect the last user message as content parts. Text-only
    // calls keep the plain string shape so every OpenAI-compatible endpoint
    // continues to work unchanged.
    const payloadMessages = messages.map((message, index) => {
      if (
        index !== messages.length - 1 ||
        message.role !== "user" ||
        !opts?.images?.length
      ) {
        return message;
      }
      return {
        role: message.role,
        content: [
          { type: "text", text: message.content },
          ...opts.images.map((imageUrl) => ({
            type: "image_url",
            image_url: { url: imageUrl },
          })),
        ],
      };
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.models[0].id,
        messages: payloadMessages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 4000,
        response_format: responseFormat,
      }),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    this.logger.debug(`AI call to ${this.config.models[0].id} (${content.length} chars)`);
    return {
      text: content,
      model: this.config.models[0].id,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    if (!this.config.apiKey) return { ok: false, message: "No API key configured" };
    try {
      await this.chat([{ role: "user", content: "ping" }], { maxTokens: 5 });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Convenience for the orchestrator: list configured models. */
  listModels(): ProviderModelConfig[] {
    return this.config.models;
  }
}
