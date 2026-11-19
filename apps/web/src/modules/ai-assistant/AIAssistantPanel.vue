<script setup lang="ts">
// AI Assistant — bottom zone. The heart of the conversational loop:
//   user types a prompt → document is generated → user keeps chatting on the
//   SAME session to refine (patch-based edits keep full context).
// plan/06: canvas keeps working even if AI is offline — errors shown here.
import { computed, ref } from "vue";
import { useDocumentStore } from "../../stores/document";
import { useAiStore } from "../../stores/ai";
import VersionHistoryDialog from "../versions/VersionHistoryDialog.vue";

const doc = useDocumentStore();
const ai = useAiStore();
const draft = ref("");
const showHistory = ref(false);

const savedLabel = computed(() =>
  doc.lastSavedAt
    ? doc.lastSavedAt.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "",
);

async function submit() {
  const prompt = draft.value.trim();
  if (!prompt) return;

  if (doc.document) {
    // Conversational edit on the current document (same session).
    await ai.edit(prompt, doc.document, doc.selectedId, (result) => {
      if (result.patches.length > 0) doc.applyPatches(result.patches, "Chỉnh sửa bằng AI");
      else if (result.document) doc.setDocument(result.document);
    });
  } else {
    // First message → full generation.
    await ai.generate(
      prompt,
      (newDoc) => doc.setDocument(newDoc),
      doc.viewportMode,
    );
  }
  draft.value = "";
}
</script>

<template>
  <section class="flex h-56 shrink-0 flex-col border-t border-ds-border bg-white">
    <div class="shrink-0 flex items-center justify-between border-b border-ds-border px-3 py-2">
      <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">AI Assistant</span>
      <div class="flex items-center gap-3 text-xs text-slate-400">
        <button
          class="hover:text-slate-600 disabled:opacity-40"
          title="Lịch sử phiên bản"
          :disabled="!doc.projectId || !doc.document"
          @click="showHistory = true"
        >
          🕘 Lịch sử
        </button>
        <span v-if="doc.isSaving" class="text-slate-400">Đang lưu…</span>
        <span v-else-if="doc.saveError" class="text-red-500" :title="doc.saveError">Lỗi lưu</span>
        <span v-else-if="doc.isDirty" class="text-amber-500">● chưa lưu</span>
        <span v-else-if="savedLabel" class="text-emerald-600">Đã lưu {{ savedLabel }}</span>
        <button class="hover:text-slate-600 disabled:opacity-40" title="Undo (Ctrl+Z)" :disabled="!doc.canUndo" @click="doc.undo()">↶ Undo</button>
        <button class="hover:text-slate-600 disabled:opacity-40" title="Redo (Ctrl+Y)" :disabled="!doc.canRedo" @click="doc.redo()">↷ Redo</button>
        <button class="hover:text-slate-600 disabled:opacity-40" title="Lưu (Ctrl+S)" :disabled="!doc.isDirty || doc.isSaving" @click="doc.save()">💾 Lưu</button>
      </div>
    </div>

    <div class="panel-scroll flex-1 space-y-2 overflow-auto px-3 py-2">
      <p v-if="ai.messages.length === 0" class="text-center text-sm text-slate-400">
        Mô tả giao diện bạn muốn tạo, hoặc chọn một component rồi yêu cầu chỉnh sửa.
      </p>
      <div
        v-for="(m, i) in ai.messages"
        :key="i"
        class="rounded-lg px-3 py-2 text-sm"
        :class="m.role === 'user' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-700'"
      >
        {{ m.content }}
      </div>
    </div>

    <form class="flex shrink-0 gap-2 border-t border-ds-border p-2" @submit.prevent="submit">
      <input
        v-model="draft"
        class="flex-1 rounded-md border border-ds-border px-3 py-2 text-sm outline-none focus:border-blue-500"
        :placeholder="doc.document ? 'Chỉnh sửa: ví dụ “đổi sidebar rộng 300px”…' : 'Nhập prompt để tạo mockup…'"
        :disabled="ai.isGenerating"
      />
      <button
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        :disabled="ai.isGenerating || !draft.trim()"
      >
        {{ ai.isGenerating ? "Đang xử lý…" : "Gửi" }}
      </button>
    </form>

    <VersionHistoryDialog :open="showHistory" @close="showHistory = false" />
  </section>
</template>
