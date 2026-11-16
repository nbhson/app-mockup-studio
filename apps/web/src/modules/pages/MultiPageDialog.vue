<script setup lang="ts">
// ---------------------------------------------------------------------------
// AI multi-page generation (plan/07 3.4) — one prompt → several linked pages
// that share one theme. Applying replaces the project's pages atomically.
// Works offline with the API heuristic generator.
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { MultiPageResult } from "@ai-mockup-studio/shared-types";
import type { ViewportMode } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const prompt = ref("Landing page cho sản phẩm SaaS quản lý dự án");
const pageCount = ref(3);
const viewportMode = ref<ViewportMode>("desktop");
const loading = ref(false);
const applying = ref(false);
const error = ref<string | null>(null);
const result = ref<MultiPageResult | null>(null);

const totalNodes = computed(() =>
  (result.value?.pages ?? []).reduce((sum, page) => sum + countNodes(page.document.root), 0),
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
      result.value = null;
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function close() {
  emit("close");
}

interface NodeLike {
  children?: NodeLike[];
}

function countNodes(node: NodeLike): number {
  return (
    1 +
    (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0)
  );
}

async function run() {
  if (loading.value) return;
  const trimmed = prompt.value.trim();
  if (!trimmed) {
    error.value = "Hãy mô tả sản phẩm hoặc website bạn muốn tạo";
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.post<MultiPageResult>("/ai/multi-page", {
      prompt: trimmed,
      pageCount: pageCount.value,
      viewportMode: viewportMode.value,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tạo được các trang";
  } finally {
    loading.value = false;
  }
}

async function apply() {
  if (!result.value || applying.value) return;
  applying.value = true;
  error.value = null;
  try {
    await doc.replacePages({
      pages: result.value.pages.map((page) => ({
        name: page.name,
        slug: page.slug,
        document: page.document,
      })),
    });
    close();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không áp dụng được các trang";
  } finally {
    applying.value = false;
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
        aria-labelledby="multi-page-title"
        class="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="multi-page-title" class="text-sm font-semibold text-slate-800">
              ✨ Tạo nhiều trang bằng AI
            </h2>
            <p class="text-[11px] text-slate-400">
              Một prompt → nhiều trang liên kết, dùng chung theme và điều hướng
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
          <label class="block text-[11px] font-medium text-slate-600" for="multi-page-prompt">
            Mô tả sản phẩm / website
          </label>
          <textarea
            id="multi-page-prompt"
            v-model="prompt"
            rows="3"
            class="mt-1 w-full resize-none rounded-md border border-ds-border px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
            placeholder="Ví dụ: Landing page cho ứng dụng quản lý dự án, phong cách hiện đại"
            @keydown.meta.enter="run"
            @keydown.ctrl.enter="run"
          />

          <div class="mt-3 flex flex-wrap items-end gap-3">
            <label class="text-[11px] font-medium text-slate-600">
              Số trang
              <select
                v-model.number="pageCount"
                class="mt-1 block rounded-md border border-ds-border px-2 py-1.5 text-xs text-slate-700"
              >
                <option v-for="count in [2, 3, 4, 5]" :key="count" :value="count">
                  {{ count }} trang
                </option>
              </select>
            </label>
            <label class="text-[11px] font-medium text-slate-600">
              Viewport
              <select
                v-model="viewportMode"
                class="mt-1 block rounded-md border border-ds-border px-2 py-1.5 text-xs text-slate-700"
              >
                <option value="desktop">Desktop</option>
                <option value="tablet">Tablet</option>
                <option value="mobile">Mobile</option>
              </select>
            </label>
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="loading"
              @click="run"
            >
              {{ loading ? "Đang tạo…" : result ? "↻ Tạo lại" : "Tạo trang" }}
            </button>
            <span class="text-[10px] text-slate-400">⌘/Ctrl + Enter</span>
          </div>

          <div v-if="loading" class="py-12 text-center">
            <div
              class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
            />
            <p class="mt-3 text-sm text-slate-500">Đang thiết kế các trang…</p>
          </div>

          <div
            v-else-if="error"
            class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center"
          >
            <p class="text-sm font-medium text-red-700">Không tạo được các trang</p>
            <p class="mt-1 text-xs text-red-600">{{ error }}</p>
          </div>

          <template v-else-if="result">
            <div class="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span
                class="rounded px-1.5 py-0.5 font-medium"
                :class="
                  result.source === 'ai'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-slate-100 text-slate-500'
                "
              >
                {{ result.source === "ai" ? `AI · ${result.model ?? "model"}` : "Sinh cục bộ" }}
              </span>
              <span>{{ result.pages.length }} trang · {{ totalNodes }} component</span>
              <span class="text-slate-300">·</span>
              <span class="inline-flex items-center gap-1">
                Theme
                <span
                  class="inline-block h-3 w-3 rounded-full border border-slate-200"
                  :style="{ backgroundColor: result.theme.primary }"
                  :title="`Primary ${result.theme.primary}`"
                />
                <span
                  class="inline-block h-3 w-3 rounded-full border border-slate-200"
                  :style="{ backgroundColor: result.theme.background }"
                  :title="`Background ${result.theme.background}`"
                />
                <span
                  class="inline-block h-3 w-3 rounded-full border border-slate-200"
                  :style="{ backgroundColor: result.theme.foreground }"
                  :title="`Foreground ${result.theme.foreground}`"
                />
              </span>
            </div>
            <p class="mt-1 text-[11px] text-slate-500">{{ result.summary }}</p>

            <ul class="mt-3 grid gap-2 sm:grid-cols-2">
              <li
                v-for="(page, index) in result.pages"
                :key="page.slug"
                class="rounded-lg border border-ds-border px-3 py-2"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-500"
                  >
                    {{ index + 1 }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                    {{ page.name }}
                  </span>
                  <span class="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                    /{{ page.slug }}
                  </span>
                </div>
                <div class="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{{ countNodes(page.document.root) }} component</span>
                  <span>{{ page.document.viewport.width }}×{{ page.document.viewport.height }}</span>
                </div>
              </li>
            </ul>

            <p class="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              Khi áp dụng, toàn bộ {{ doc.pages.length }} trang hiện tại sẽ được thay bằng
              {{ result.pages.length }} trang mới. Thay đổi chưa lưu và lịch sử phiên bản
              của các trang cũ sẽ bị xoá.
            </p>
          </template>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button
            class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            @click="close"
          >
            Huỷ
          </button>
          <button
            class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="!result || applying || loading || doc.isSaving"
            @click="apply"
          >
            {{ applying ? "Đang áp dụng…" : `Áp dụng ${result?.pages.length ?? 0} trang` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
