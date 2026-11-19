<script setup lang="ts">
// ---------------------------------------------------------------------------
// AI design critique dialog (plan/07 3.5) — sends the current document to the
// API, which returns a score + actionable findings. Works offline: the API
// falls back to a deterministic analyzer when no model is configured.
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { DesignCritiqueResult } from "@ai-mockup-studio/shared-types";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<DesignCritiqueResult | null>(null);
const appliedMessage = ref<string | null>(null);

const fixable = computed(
  () => result.value?.findings.filter((finding) => finding.fixStyles) ?? [],
);
const scoreTone = computed(() => {
  const score = result.value?.score ?? 0;
  if (score >= 80) return { text: "text-emerald-600", bar: "bg-emerald-500" };
  if (score >= 60) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-red-600", bar: "bg-red-500" };
});
const modeLabel = computed(() => {
  switch (doc.viewportMode) {
    case "tablet":
      return "Tablet";
    case "mobile":
      return "Mobile";
    default:
      return "Desktop";
  }
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Clear the previous run first: `run()` returns early when there is no
      // document, and the stale findings of the last session would otherwise
      // render with Apply buttons that silently no-op.
      result.value = null;
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
  // Pin the project/page: a critique computed for the document the user has
  // since navigated away from must not populate Apply buttons for it.
  const ctx = doc.captureContext();
  try {
    const response = await api.post<DesignCritiqueResult>("/ai/critique", {
      document: doc.document,
      viewportMode: doc.viewportMode,
    });
    if (!doc.isContextCurrent(ctx)) {
      error.value =
        "Bạn đã chuyển trang/dự án trong lúc phân tích — kết quả không được áp dụng.";
      return;
    }
    result.value = response;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không chạy được critique";
  } finally {
    loading.value = false;
  }
}

function applyFixes(
  findings: NonNullable<DesignCritiqueResult["findings"]> = result.value?.findings ?? [],
) {
  if (!doc.document) return;
  const selected = findings.filter((finding) => finding.fixStyles);
  if (selected.length === 0) return;

  const mode = doc.viewportMode;
  const patches = selected.map((finding) => {
    if (mode === "desktop") {
      return {
        op: "style" as const,
        targetId: finding.nodeId ?? doc.document!.root.id,
        styles: finding.fixStyles as Record<string, unknown>,
      };
    }
    return {
      op: "update" as const,
      targetId: finding.nodeId ?? doc.document!.root.id,
      changes: Object.fromEntries(
        Object.entries(finding.fixStyles as Record<string, unknown>).map(
          ([key, value]) => [`responsive.${mode}.${key}`, value],
        ),
      ),
    };
  });

  // The critique was computed against an older snapshot, so a finding may
  // target a node that has since been deleted. `applyPatchBatch` throws in
  // that case BEFORE any state changes — the whole batch is atomic, nothing
  // partial is applied and no no-op entry reaches the undo history. Show an
  // error and force a fresh run instead of falsely reporting "Applied".
  let next: UiDocument;
  try {
    next = applyPatchBatch(doc.document, patches);
  } catch {
    appliedMessage.value = null;
    result.value = null;
    error.value =
      "Tài liệu đã thay đổi (có component bị xoá sau khi phân tích) — vui lòng chạy lại critique.";
    return;
  }
  doc.mutate(next, "Áp dụng gợi ý design critique");
  appliedMessage.value = `Đã áp dụng ${selected.length} gợi ý.`;
  void run();
}

function severityLabel(severity: "high" | "medium" | "low"): string {
  return severity === "high" ? "Nghiêm trọng" : severity === "medium" ? "Trung bình" : "Nhỏ";
}

function categoryLabel(category: string): string {
  switch (category) {
    case "hierarchy":
      return "Hierarchy";
    case "spacing":
      return "Spacing";
    case "contrast":
      return "Contrast";
    case "consistency":
      return "Consistency";
    case "accessibility":
      return "Accessibility";
    case "content":
      return "Content";
    default:
      return category;
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
        aria-labelledby="critique-title"
        class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="critique-title" class="text-sm font-semibold text-slate-800">
              AI design critique
            </h2>
            <p class="text-[11px] text-slate-400">
              Hierarchy · spacing · contrast · token · accessibility · breakpoint {{ modeLabel }}
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
          <div v-if="loading" class="py-16 text-center">
            <div class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            <p class="mt-3 text-sm text-slate-500">Đang đánh giá thiết kế…</p>
          </div>

          <div
            v-else-if="error"
            class="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center"
          >
            <p class="text-sm font-medium text-red-700">Không chạy được critique</p>
            <p class="mt-1 text-xs text-red-600">{{ error }}</p>
            <button
              class="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
              @click="run"
            >
              Thử lại
            </button>
          </div>

          <template v-else-if="result">
            <div class="flex items-start gap-4 rounded-lg border border-ds-border p-4">
              <div class="text-center">
                <div class="text-4xl font-bold" :class="scoreTone.text">
                  {{ result.score }}
                </div>
                <div class="text-[10px] uppercase tracking-wide text-slate-400">/ 100</div>
              </div>
              <div class="min-w-0 flex-1">
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="scoreTone.bar"
                    :style="{ width: `${result.score}%` }"
                  />
                </div>
                <p class="mt-2 text-xs leading-5 text-slate-700">{{ result.summary }}</p>
                <div class="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
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
                  <span>{{ result.findings.length }} phát hiện</span>
                  <span v-if="fixable.length">{{ fixable.length }} có thể sửa tự động</span>
                </div>
              </div>
            </div>

            <div
              v-if="result.findings.length === 0"
              class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-6 text-center"
            >
              <div class="text-2xl">✓</div>
              <p class="mt-2 text-sm font-medium text-emerald-700">
                Không phát hiện vấn đề đáng kể
              </p>
              <p class="mt-1 text-xs text-emerald-600">
                Bố cục, tương phản và việc dùng token đang ở trạng thái tốt.
              </p>
            </div>

            <ul v-else class="mt-3 space-y-2">
              <li
                v-for="finding in result.findings"
                :key="finding.id"
                class="rounded-lg border border-ds-border px-3 py-2"
              >
                <div class="flex items-start gap-2">
                  <span
                    class="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                    :class="
                      finding.severity === 'high'
                        ? 'bg-red-500'
                        : finding.severity === 'medium'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                    "
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="text-xs font-semibold text-slate-800">
                        {{ finding.title }}
                      </span>
                      <span
                        class="rounded px-1.5 py-0.5 text-[10px]"
                        :class="
                          finding.severity === 'high'
                            ? 'bg-red-50 text-red-600'
                            : finding.severity === 'medium'
                              ? 'bg-amber-50 text-amber-600'
                              : 'bg-slate-100 text-slate-500'
                        "
                      >
                        {{ severityLabel(finding.severity) }}
                      </span>
                      <span class="text-[10px] text-slate-400">
                        {{ categoryLabel(finding.category) }}
                        <template v-if="finding.nodeId"> · {{ finding.nodeId }}</template>
                      </span>
                    </div>
                    <p class="mt-1 text-xs text-slate-700">{{ finding.detail }}</p>
                    <p class="text-[11px] text-slate-500">{{ finding.suggestion }}</p>
                  </div>
                  <button
                    v-if="finding.fixStyles"
                    class="shrink-0 rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                    @click="applyFixes([finding])"
                  >
                    Áp dụng
                  </button>
                </div>
              </li>
            </ul>

            <p
              v-if="appliedMessage"
              class="mt-2 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-600"
            >
              {{ appliedMessage }}
            </p>
          </template>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-ds-border px-4 py-3">
          <button
            class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            :disabled="loading"
            @click="run"
          >
            ↻ Chạy lại
          </button>
          <div class="flex items-center gap-2">
            <button
              class="rounded-md border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              @click="close"
            >
              Đóng
            </button>
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="loading || fixable.length === 0"
              @click="applyFixes()"
            >
              Áp dụng tất cả ({{ fixable.length }})
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
