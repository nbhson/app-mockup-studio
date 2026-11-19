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
  private readonly timeoutMs: number;
  /** Set once the endpoint proves it does not understand `reasoning_effort`. */
  private effortUnsupported = false;

  constructor(private readonly configService: ConfigService) {
    // LLM calls must never hang forever: without a timeout a stalled
    // endpoint blocks the request, skips the retry loop, and the UI sits on
    // "processing" with no fallback. Override with AI_TIMEOUT_MS (5s–600s).
    //
    // The default is deliberately generous: structured UI output is several
    // thousand tokens and reasoning models (qwen3, o-series, deepseek-r1)
    // spend part of that budget "thinking" before they write any JSON. Real
    // measurements for one page here run 60–90 s, so a 45 s ceiling aborted
    // every attempt and the user always landed on the offline mockup fallback.
    const raw = Number(this.configService.get<string>("AI_TIMEOUT_MS"));
    this.timeoutMs =
      Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000 ? raw : 90_000;
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

    // Per-call ceiling: the orchestrator shrinks retries to whatever is left
    // of its budget, so a slow answer cannot make the browser wait past the
    // time it has already waited. AI_TIMEOUT_MS stays the hard upper bound.
    const timeoutMs =
      opts?.timeoutMs != null
        ? Math.max(5_000, Math.min(opts.timeoutMs, this.timeoutMs))
        : this.timeoutMs;

    const send = async (body: string): Promise<Response> => {
      const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
      if (opts?.signal) {
        if (opts.signal.aborted) throw new Error("AI call aborted");
        signals.push(opts.signal);
      }
      try {
        return await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body,
          signal: AbortSignal.any(signals),
        });
      } catch (e) {
        // undici surfaces both an aborted timer and a dead endpoint as a
        // generic fetch failure. Normalize the timeout so the pipeline can
        // tell "the model is too slow" from "the answer was invalid" instead
        // of spending three retries on the same wait.
        const name = e instanceof Error ? e.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          throw new Error(`AI timeout after ${timeoutMs}ms`);
        }
        throw e;
      }
    };

    const payload = (effort?: string) =>
      JSON.stringify({
        model: this.config.models[0].id,
        messages: payloadMessages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 4000,
        response_format: responseFormat,
        // Reasoning models spend most of the wall clock thinking instead of
        // writing (one page went from ~40 s to ~135 s). The pipeline asks for
        // a bounded effort; AI_REASONING_EFFORT controls it.
        ...(effort ? { reasoning_effort: effort } : {}),
      });

    const effort = this.effortUnsupported ? undefined : opts?.reasoningEffort;
    let res = await send(payload(effort));

    if (!res.ok && effort) {
      // Strict OpenAI-compatible gateways (vLLM, llama.cpp, some proxies)
      // reject unknown body keys, which would break *every* AI feature. If the
      // only complaint is reasoning_effort, stop sending it in this process.
      const text = await res.text().catch(() => "");
      const rejectedKey =
        (res.status === 400 || res.status === 422) && /reasoning/i.test(text);
      if (!rejectedKey) {
        throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 300)}`);
      }
      this.effortUnsupported = true;
      this.logger.warn(`${this.config.baseURL} rejected reasoning_effort; retrying without it`);
      res = await send(payload(undefined));
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    this.logger.debug(`AI call to ${this.config.models[0].id} (${content.length} chars)`);
    return {
      text: content,
      model: this.config.models[0].id,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
      // "length" means the JSON was cut off mid-document: the caller must not
      // read that as "the model is wrong", it must ask for more room.
      finishReason: choice?.finish_reason,
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
