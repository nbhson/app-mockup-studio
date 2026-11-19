<script setup lang="ts">
// ---------------------------------------------------------------------------
// AI component recommendation dialog (plan/07 3.9) — suggests the next
// components to add from a user goal + the current document. Each suggestion
// is inserted with a normal "add" patch, so undo/redo and persistence work.
// Works offline (local analyzer).
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  ComponentRecommendResult,
  ComponentRecommendation,
} from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import { buildNodeFromType } from "../../stores/editor";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const loading = ref(false);
const error = ref<string | null>(null);
const prompt = ref("");
const result = ref<ComponentRecommendResult | null>(null);
const added = ref<string[]>([]);

const suggestions = computed(() => result.value?.suggestions ?? []);
const pending = computed(() =>
  suggestions.value.filter((suggestion) => !added.value.includes(suggestion.type)),
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      added.value = [];
      window.addEventListener("keydown", onKeydown);
      void run();
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
  if (!doc.document || loading.value) return;
  loading.value = true;
  error.value = null;
  added.value = [];
  try {
    result.value = await api.post<ComponentRecommendResult>("/ai/recommend-components", {
      document: doc.document,
      prompt: prompt.value.trim() || undefined,
      max: 6,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không lấy được gợi ý component";
  } finally {
    loading.value = false;
  }
}

function addComponent(suggestion: ComponentRecommendation) {
  if (!doc.document) return;
  const node = buildNodeFromType(suggestion.type);
  if (!node) {
    error.value = `Component "${suggestion.type}" không còn khả dụng.`;
    return;
  }
  const selected = doc.selectedNode;
  const parentId =
    selected && selected.children !== undefined ? selected.id : doc.document.root.id;
  doc.applyPatches(
    [{ op: "add", parentId, node }],
    `Thêm ${node.name ?? suggestion.label}`,
  );
  doc.setSelection([node.id], node.id);
  added.value = [...added.value, suggestion.type];
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    layout: "Layout",
    dashboard: "Dashboard",
    basic: "Basic",
    formal: "Formal",
  };
  return labels[category] ?? category;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[1.5px] p-4"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommend-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="recommend-title" class="text-sm font-semibold text-slate-800">
              Gợi ý component
            </h2>
            <p class="text-[11px] text-slate-400">
              Đề xuất component tiếp theo dựa trên mục tiêu và bố cục hiện tại
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

        <div class="flex items-center gap-2 border-b border-ds-border px-4 py-2">
          <input
            v-model="prompt"
            type="text"
            placeholder="Bạn muốn xây gì tiếp theo? (vd: thêm bảng đơn hàng)"
            class="min-w-0 flex-1 rounded border border-ds-border px-2 py-1 text-xs"
            @keydown.enter.prevent="run"
          />
          <button
            class="shrink-0 rounded-md bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="loading"
            @click="run"
          >
            {{ loading ? "Đang phân tích…" : "Gợi ý" }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <div v-if="loading" class="py-16 text-center">
            <div
              class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
            />
            <p class="mt-3 text-sm text-slate-500">Đang phân tích bố cục…</p>
          </div>

          <div
            v-else-if="error"
            class="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center"
          >
            <p class="text-sm font-medium text-red-700">Không lấy được gợi ý</p>
            <p class="mt-1 text-xs text-red-600">{{ error }}</p>
            <button
              class="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              @click="run"
            >
              Thử lại
            </button>
          </div>

          <template v-else-if="result">
            <div
              v-if="suggestions.length === 0"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-8 text-center"
            >
              <div class="text-2xl">✓</div>
              <p class="mt-2 text-sm font-medium text-emerald-700">
                Chưa có gợi ý phù hợp
              </p>
              <p class="mt-1 text-xs text-emerald-600">{{ result.summary }}</p>
            </div>

            <template v-else>
              <div class="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
                <span
                  class="rounded px-1.5 py-0.5 font-medium"
                  :class="
                    result.source === 'ai'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-slate-100 text-slate-500'
                  "
                >
                  {{ result.source === "ai" ? `AI · ${result.model ?? "model"}` : "Phân tích cục bộ" }}
                </span>
                <span>{{ result.summary }}</span>
              </div>

              <ul class="space-y-2">
                <li
                  v-for="suggestion in suggestions"
                  :key="suggestion.type"
                  class="rounded-lg border px-3 py-2"
                  :class="
                    added.includes(suggestion.type)
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-ds-border'
                  "
                >
                  <div class="flex items-start gap-2">
                    <span
                      class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      :class="
                        suggestion.score >= 75
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-slate-100 text-slate-500'
                      "
                    >
                      {{ suggestion.score }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs font-semibold text-slate-800">
                          {{ suggestion.label }}
                        </span>
                        <span class="font-mono text-[10px] text-slate-400">
                          {{ suggestion.type }}
                        </span>
                        <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {{ categoryLabel(suggestion.category) }}
                        </span>
                        <span
                          v-if="added.includes(suggestion.type)"
                          class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700"
                        >
                          Đã thêm
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-slate-700">{{ suggestion.reason }}</p>
                    </div>
                    <button
                      v-if="!added.includes(suggestion.type)"
                      class="shrink-0 rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                      @click="addComponent(suggestion)"
                    >
                      Thêm
                    </button>
                  </div>
                </li>
              </ul>
            </template>
          </template>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
          <span v-if="added.length > 0" class="mr-auto text-[11px] text-emerald-600">
            Đã thêm {{ added.length }} component
          </span>
          <button
            class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            @click="close"
          >
            Đóng
          </button>
          <button
            class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="loading || pending.length === 0"
            @click="pending.forEach(addComponent)"
          >
            Thêm tất cả ({{ pending.length }})
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
