<script setup lang="ts">
// ---------------------------------------------------------------------------
// URL-to-UI dialog (plan/07 3.2) — fetch a public page safely and recreate its
// main layout as an editable document. Static HTML is fully supported;
// JavaScript-rendered content is approximated from server markup.
// ---------------------------------------------------------------------------
import { onBeforeUnmount, ref, watch } from "vue";
import type { UrlToUiResult } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const url = ref("");
const prompt = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<UrlToUiResult | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      result.value = null;
      error.value = null;
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function close() {
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

async function run() {
  const value = url.value.trim();
  if (!value || loading.value) return;
  loading.value = true;
  error.value = null;
  result.value = null;
  try {
    const response = await api.post<UrlToUiResult>("/ai/url-to-ui", {
      url: value,
      prompt: prompt.value.trim() || undefined,
    });
    doc.setDocument(response.document);
    result.value = response;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không phân tích được URL";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="url-to-ui-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="url-to-ui-title" class="text-sm font-semibold text-slate-800">
              URL → UI
            </h2>
            <p class="text-[11px] text-slate-400">
              Phân tích trang web công khai và dựng lại bố cục chính thành mockup
            </p>
          </div>
          <button
            class="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Đóng (Esc)"
            @click="close"
          >
            ✕
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <label class="mb-1 block text-[11px] font-medium text-slate-500">URL trang web</label>
          <div class="flex gap-2">
            <input
              v-model="url"
              type="url"
              placeholder="https://example.com"
              class="min-w-0 flex-1 rounded border border-ds-border px-2 py-1.5 text-xs"
              @keydown.enter.prevent="run"
            />
            <button
              class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="loading || !url.trim()"
              @click="run"
            >
              {{ loading ? "Đang phân tích…" : "Phân tích" }}
            </button>
          </div>

          <div class="mt-3">
            <label class="mb-1 block text-[11px] font-medium text-slate-500">
              Mô tả thêm (không bắt buộc)
            </label>
            <input
              v-model="prompt"
              type="text"
              placeholder="vd: chỉ giữ phần hero và bảng giá…"
              class="w-full rounded border border-ds-border px-2 py-1.5 text-xs"
            />
          </div>

          <p class="mt-2 text-[11px] text-slate-400">
            Chỉ hỗ trợ trang HTML công khai (http/https). URL nội bộ bị chặn.
            Trang render bằng JavaScript có thể chỉ dựng được nội dung tĩnh.
          </p>

          <div v-if="loading" class="py-10 text-center">
            <div
              class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
            />
            <p class="mt-3 text-sm text-slate-500">Đang tải và phân tích trang…</p>
          </div>

          <div
            v-else-if="error"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            {{ error }}
          </div>

          <div
            v-if="result"
            class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                {{ result.source === "ai" ? `AI · ${result.model ?? "model"}` : "Phân tích cục bộ" }}
              </span>
              <span class="truncate text-[11px] text-emerald-700">{{ result.url }}</span>
              <span class="text-[11px] text-emerald-700">
                Đã áp dụng vào canvas — Ctrl+Z để hoàn tác
              </span>
            </div>
            <p class="mt-1 text-xs text-emerald-700">{{ result.summary }}</p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button
            class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            @click="close"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
