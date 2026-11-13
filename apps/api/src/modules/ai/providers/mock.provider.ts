import { Injectable } from "@nestjs/common";
import type {
  AIProviderService,
  AiChatOptions,
  AiChatResult,
  AiRequestMessage,
  AIProviderConfig,
} from "@ai-mockup-studio/ai-core";

// ---------------------------------------------------------------------------
// Mock provider — used when no real API key is configured, so the full
// pipeline (generate → validate → render → edit) can be exercised offline.
// It ignores the prompt and returns a canned document via ai-service logic.
// ---------------------------------------------------------------------------

@Injectable()
export class MockProviderService implements AIProviderService {
  readonly config: AIProviderConfig = {
    id: "mock",
    name: "Built-in Mock",
    type: "custom",
    baseURL: "mock://local",
    enabled: true,
    models: [
      {
        id: "mock-model",
        name: "Mock Generator",
        capabilities: {
          textGeneration: true,
          vision: false,
          streaming: false,
          structuredOutput: true,
          toolCalling: false,
        },
      },
    ],
  };

  /** The mock provider does not do free-form chat; the ai.service short-circuits. */
  async chat(_messages: AiRequestMessage[], _opts?: AiChatOptions): Promise<AiChatResult> {
    throw new Error("Mock provider is not called directly; ai.service handles it.");
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: "Mock provider ready (no API key required)" };
  }
}
