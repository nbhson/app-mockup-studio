import { defineStore } from "pinia";
import { ref } from "vue";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import type { GenerateResult, AiEditResult } from "@ai-mockup-studio/shared-types";
import { api } from "../services/api";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// AI State (plan/09 8.2) — prompt, generation status, conversation history.
// Kept separate from Document State; the canvas works even when AI is down.
// ---------------------------------------------------------------------------

export const useAiStore = defineStore("ai", () => {
  const isGenerating = ref(false);
  const statusText = ref("");
  const messages = ref<ChatMessage[]>([]);
  const error = ref<string | null>(null);

  /**
   * Text-to-UI: call backend, then push the generated document into the
   * document store (same session keeps chatting afterwards — the AI state
   * retains history, so follow-up edits have full context).
   */
  async function generate(
    prompt: string,
    onGenerated?: (doc: UiDocument) => void,
  ) {
    if (!prompt.trim() || isGenerating.value) return;
    isGenerating.value = true;
    error.value = null;
    statusText.value = "Đang phân tích yêu cầu…";
    messages.value.push({ role: "user", content: prompt });
    try {
      statusText.value = "Đang tạo giao diện…";
      const result = await api.post<GenerateResult>("/ai/generate", { prompt });
      messages.value.push({ role: "assistant", content: result.summary });
      onGenerated?.(result.document);
      statusText.value = "Hoàn tất.";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Generation failed";
      messages.value.push({
        role: "assistant",
        content: `⚠️ ${error.value}`,
      });
    } finally {
      statusText.value = "";
      isGenerating.value = false;
    }
  }

  /** Conversational editing: send current doc + prompt, apply returned patches. */
  async function edit(
    prompt: string,
    document: UiDocument,
    targetId: string | null,
    onPatches?: (result: AiEditResult) => void,
  ) {
    if (!prompt.trim() || isGenerating.value) return;
    isGenerating.value = true;
    error.value = null;
    statusText.value = "Đang chỉnh sửa…";
    messages.value.push({ role: "user", content: prompt });
    try {
      const result = await api.post<AiEditResult>("/ai/edit", {
        prompt,
        document,
        targetId,
      });
      messages.value.push({ role: "assistant", content: result.summary });
      onPatches?.(result);
      statusText.value = "Hoàn tất.";
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Edit failed";
      messages.value.push({
        role: "assistant",
        content: `⚠️ ${error.value}`,
      });
    } finally {
      statusText.value = "";
      isGenerating.value = false;
    }
  }

  function clearHistory() {
    messages.value = [];
    error.value = null;
  }

  return { isGenerating, statusText, messages, error, generate, edit, clearHistory };
});
