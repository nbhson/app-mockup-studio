<script setup lang="ts">
// ---------------------------------------------------------------------------
// AI responsive optimization dialog (plan/07 3.8) — proposes safe tablet/mobile
// overrides. Every suggestion is written to node.responsive[breakpoint]; the
// desktop base styles are never touched. Works offline (local analyzer).
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  ResponsiveBreakpoint,
  ResponsiveOptimizeResult,
  ResponsiveSuggestion,
} from "@ai-mockup-studio/shared-types";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

type Filter = "all" | ResponsiveBreakpoint;

const doc = useDocumentStore();
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<ResponsiveOptimizeResult | null>(null);
const filter = ref<Filter>("all");
const applied = ref<string[]>([]);
const appliedMessage = ref<string | null>(null);

const visible = computed(() => {
  const suggestions = result.value?.suggestions ?? [];
  return filter.value === "all"
    ? suggestions
    : suggestions.filter((suggestion) => suggestion.breakpoint === filter.value);
});
const pending = computed(() =>
  visible.value.filter((suggestion) => !applied.value.includes(suggestion.id)),
);
const tabletCount = computed(
  () => result.value?.suggestions.filter((s) => s.breakpoint === "tablet").length ?? 0,
);
const mobileCount = computed(
  () => result.value?.suggestions.filter((s) => s.breakpoint === "mobile").length ?? 0,
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      applied.value = [];
      appliedMessage.value = null;
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
  applied.value = [];
  try {
    result.value = await api.post<ResponsiveOptimizeResult>("/ai/responsive", {
      document: doc.document,
      breakpoints: ["tablet", "mobile"],
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không phân tích được responsive";
  } finally {
    loading.value = false;
  }
}

function applySuggestions(suggestions: ResponsiveSuggestion[] = pending.value) {
  if (!doc.document || suggestions.length === 0) return;
  const patches = suggestions.map((suggestion) => ({
    op: "update" as const,
    targetId: suggestion.nodeId,
    changes: Object.fromEntries(
      Object.entries(suggestion.styles).map(([key, value]) => [
        `responsive.${suggestion.breakpoint}.${key}`,
        value,
      ]),
    ),
  }));

  try {
    const next = applyPatchBatch(doc.document, patches);
    doc.mutate(next, "Tối ưu responsive");
    applied.value = [
      ...new Set([...applied.value, ...suggestions.map((suggestion) => suggestion.id)]),
    ];
    appliedMessage.value = `Đã áp dụng ${suggestions.length} override (desktop giữ nguyên).`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không áp dụng được gợi ý";
  }
}

function preview(styles: Record<string, unknown>): string {
  return Object.entries(styles)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function setFilter(id: string) {
  filter.value = id as Filter;
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
        aria-labelledby="responsive-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="responsive-title" class="text-sm font-semibold text-slate-800">
              Tối ưu responsive
            </h2>
            <p class="text-[11px] text-slate-400">
              Đề xuất override tablet/mobile an toàn · desktop không thay đổi
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

        <div class="flex flex-wrap items-center gap-2 border-b border-ds-border px-4 py-2">
          <button
            v-for="option in [
              { id: 'all', label: 'Tất cả' },
              { id: 'tablet', label: `Tablet (${tabletCount})` },
              { id: 'mobile', label: `Mobile (${mobileCount})` },
            ]"
            :key="option.id"
            class="rounded px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              filter === option.id
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-500 hover:bg-slate-100'
            "
            :aria-pressed="filter === option.id"
            @click="setFilter(option.id)"
          >
            {{ option.label }}
          </button>
          <button
            class="ml-auto rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            :disabled="loading"
            @click="run"
          >
            ↻ Phân tích lại
          </button>
          <span
            v-if="appliedMessage"
            class="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-600"
          >
            {{ appliedMessage }}
          </span>
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
            <p class="text-sm font-medium text-red-700">Không phân tích được responsive</p>
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
              v-if="result.suggestions.length === 0"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-8 text-center"
            >
              <div class="text-2xl">✓</div>
              <p class="mt-2 text-sm font-medium text-emerald-700">
                Không có vấn đề responsive
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
                  v-for="suggestion in visible"
                  :key="suggestion.id"
                  class="rounded-lg border px-3 py-2"
                  :class="
                    applied.includes(suggestion.id)
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-ds-border'
                  "
                >
                  <div class="flex items-start gap-2">
                    <span
                      class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      :class="
                        suggestion.breakpoint === 'mobile'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-blue-50 text-blue-600'
                      "
                    >
                      {{ suggestion.breakpoint === "mobile" ? "Mobile" : "Tablet" }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs font-semibold text-slate-800">
                          {{ suggestion.title }}
                        </span>
                        <span class="text-[10px] text-slate-400">
                          {{ suggestion.nodeLabel }} · {{ suggestion.nodeId }}
                        </span>
                        <span
                          v-if="applied.includes(suggestion.id)"
                          class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700"
                        >
                          Đã áp dụng
                        </span>
                      </div>
                      <p class="mt-1 text-xs text-slate-700">{{ suggestion.detail }}</p>
                      <p class="mt-1 font-mono text-[10px] text-slate-500">
                        {{ preview(suggestion.styles) }}
                      </p>
                    </div>
                    <button
                      v-if="!applied.includes(suggestion.id)"
                      class="shrink-0 rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                      @click="applySuggestions([suggestion])"
                    >
                      Áp dụng
                    </button>
                  </div>
                </li>
              </ul>
            </template>
          </template>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
          <button
            class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            @click="close"
          >
            Đóng
          </button>
          <button
            class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="loading || pending.length === 0"
            @click="applySuggestions()"
          >
            Áp dụng {{ filter === "all" ? "tất cả" : filter }} ({{ pending.length }})
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
