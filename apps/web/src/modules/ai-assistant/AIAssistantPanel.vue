<script setup lang="ts">
// AI Assistant — bottom zone. The heart of conversational loop:
//   user types a prompt → document is generated → user keeps chatting on the
//   SAME session to refine (patch-based edits keep full context).
// plan/06: canvas keeps working even if AI is offline — errors shown here.
import { computed, nextTick, ref, watch } from "vue";
import { useDocumentStore } from "../../stores/document";
import { useAiStore } from "../../stores/ai";
import VersionHistoryDialog from "../versions/VersionHistoryDialog.vue";

const doc = useDocumentStore();
const ai = useAiStore();
const draft = ref("");
const showHistory = ref(false);
const threadEl = ref<HTMLElement | null>(null);

const savedLabel = computed(() =>
  doc.lastSavedAt
    ? doc.lastSavedAt.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "",
);

// Keep the newest message (or the typing indicator) in view while chatting.
watch(
  () => [ai.messages.length, ai.isGenerating],
  async () => {
    await nextTick();
    threadEl.value?.scrollTo({
      top: threadEl.value.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  },
);

async function submit() {
  const prompt = draft.value.trim();
  if (!prompt) return;

  // Pin the project/page the request was made for: the AI round-trip can
  // take many seconds, and applying a late result to whatever the user
  // navigated to in the meantime would silently write the wrong document.
  const ctx = doc.captureContext();
  const dropped = () =>
    ai.messages.push({
      role: "assistant",
      content:
        "⚠️ Bạn đã chuyển trang/dự án trong lúc AI xử lý — kết quả đã bị bỏ qua.",
    });

  if (doc.document) {
    // Conversational edit on the current document (same session).
    await ai.edit(prompt, doc.document, doc.selectedId, (result) => {
      if (!doc.isContextCurrent(ctx)) {
        dropped();
        return;
      }
      try {
        // Atomic: applyPatchBatch throws when a patch targets a node that no
        // longer exists, and it does so BEFORE the command is recorded — so
        // nothing is applied and no no-op entry lands in the undo stack.
        if (result.patches.length > 0) doc.applyPatches(result.patches, "Chỉnh sửa bằng AI");
        else if (result.document) doc.setDocument(result.document);
      } catch {
        ai.messages.push({
          role: "assistant",
          content: "⚠️ Tài liệu đã thay đổi, vui lòng thử lại.",
        });
      }
    });
  } else {
    // First message → full generation.
    await ai.generate(
      prompt,
      (newDoc) => {
        if (!doc.isContextCurrent(ctx)) {
          dropped();
          return;
        }
        doc.setDocument(newDoc);
      },
      doc.viewportMode,
    );
  }
  draft.value = "";
}
</script>

<template>
  <section class="flex h-56 shrink-0 flex-col border-t border-line bg-surface">
    <div class="shrink-0 flex items-center justify-between border-b border-line px-3 py-2">
      <span class="panel-title">AI Assistant</span>
      <div class="flex items-center gap-3 text-xs text-ink-muted">
        <button class="tb-btn" title="Lịch sử phiên bản" :disabled="!doc.projectId || !doc.document" @click="showHistory = true">
          🕘 Lịch sử
        </button>
        <span v-if="doc.isSaving" class="fade-in inline-flex items-center gap-1.5">
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" aria-hidden="true" />
          Đang lưu…
        </span>
        <span v-else-if="doc.saveError" class="inline-flex items-center gap-1.5 text-danger-text" :title="doc.saveError">
          <span class="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
          Lỗi lưu
        </span>
        <span v-else-if="doc.isDirty" class="inline-flex items-center gap-1.5 text-warning-text">
          <span class="h-1.5 w-1.5 rounded-full bg-[#d97706]" aria-hidden="true" />
          chưa lưu
        </span>
        <span v-else-if="savedLabel" class="inline-flex items-center gap-1.5 text-success-text">
          <span class="h-1.5 w-1.5 rounded-full bg-success-text" aria-hidden="true" />
          Đã lưu {{ savedLabel }}
        </span>
        <button class="tb-btn" title="Undo (Ctrl+Z)" :disabled="!doc.canUndo" @click="doc.undo()">↶ Undo</button>
        <button class="tb-btn" title="Redo (Ctrl+Y)" :disabled="!doc.canRedo" @click="doc.redo()">↷ Redo</button>
        <button class="tb-btn tb-btn-accent" title="Lưu (Ctrl+S)" :disabled="!doc.isDirty || doc.isSaving" @click="doc.save()">💾 Lưu</button>
      </div>
    </div>

    <div
      ref="threadEl"
      class="panel-scroll flex-1 space-y-2 overflow-auto px-3 py-2"
      role="log"
      aria-live="polite"
      aria-label="Lịch sử hội thoại AI"
    >
      <p v-if="ai.messages.length === 0 && !ai.isGenerating" class="mx-auto mt-6 max-w-md text-center text-sm text-ink-muted">
        Mô tả giao diện bạn muốn tạo, hoặc chọn một component rồi yêu cầu chỉnh sửa.
        <span class="mt-2 block text-xs text-ink-soft">
          Ví dụ: “Dashboard bán hàng với 4 KPI, biểu đồ doanh thu và bảng đơn gần đây”
        </span>
      </p>
      <div
        v-for="(m, i) in ai.messages"
        :key="i"
        class="msg-in max-w-[85%] rounded-lg px-3 py-2 text-sm"
        :class="
          m.role === 'user'
            ? 'ml-auto bg-primary-soft text-ink'
            : 'bg-surface-hover text-ink'
        "
      >
        <span class="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {{ m.role === "user" ? "Bạn" : "AI" }}
        </span>
        {{ m.content }}
      </div>
      <div v-if="ai.isGenerating" class="msg-in flex w-fit items-center gap-2 rounded-lg bg-surface-hover px-3 py-2.5">
        <span class="flex items-center gap-1" aria-hidden="true">
          <span class="typing-dot" />
          <span class="typing-dot" />
          <span class="typing-dot" />
        </span>
        <span class="text-xs text-ink-soft">{{ doc.document ? "AI đang chỉnh sửa…" : "AI đang vẽ mockup…" }}</span>
      </div>
    </div>

    <form class="flex shrink-0 gap-2 border-t border-line p-2" @submit.prevent="submit">
      <label class="sr-only" for="ai-prompt">Tin nhắn cho AI</label>
      <input
        id="ai-prompt"
        v-model="draft"
        class="field-input"
        :placeholder="doc.document ? 'Chỉnh sửa: ví dụ “đổi sidebar rộng 300px”…' : 'Nhập prompt để tạo mockup…'"
        :disabled="ai.isGenerating"
      />
      <button
        class="btn btn-primary shrink-0"
        :disabled="ai.isGenerating || !draft.trim()"
      >
        {{ ai.isGenerating ? "Đang xử lý…" : "Gửi" }}
      </button>
    </form>

    <VersionHistoryDialog :open="showHistory" @close="showHistory = false" />
  </section>
</template>
