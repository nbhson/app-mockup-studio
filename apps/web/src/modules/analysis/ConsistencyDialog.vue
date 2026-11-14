<script setup lang="ts">
// ---------------------------------------------------------------------------
// Design consistency dialog (plan/07 3.10) — audits explicit styles against
// the design system scales and applies safe fixes through the command manager.
// Runs locally; no AI key required.
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDocumentStore } from "../../stores/document";
import {
  analyzeConsistency,
  applyConsistencyFixes,
  type ConsistencyIssue,
} from "./consistency";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const appliedMessage = ref<string | null>(null);

const issues = computed<ConsistencyIssue[]>(() =>
  doc.document ? analyzeConsistency(doc.document, doc.viewportMode) : [],
);
const warnings = computed(
  () => issues.value.filter((issue) => issue.severity === "warning").length,
);
const infos = computed(
  () => issues.value.filter((issue) => issue.severity === "info").length,
);
const fixable = computed(() => issues.value.filter((issue) => issue.fixStyles));
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
      appliedMessage.value = null;
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

function applyFixes(selected: ConsistencyIssue[] = issues.value) {
  if (!doc.document) return;
  const next = applyConsistencyFixes(doc.document, selected, doc.viewportMode);
  if (!next) return;
  doc.mutate(next, "Sửa lỗi nhất quán design system");
  appliedMessage.value = `Đã áp dụng ${selected.filter((issue) => issue.fixStyles).length} sửa đổi.`;
}

function ruleLabel(issue: ConsistencyIssue): string {
  switch (issue.rule) {
    case "spacing":
      return "Spacing";
    case "font-size":
      return "Typography";
    case "radius":
      return "Radius";
    case "color":
      return "Màu sắc";
    case "font-family":
      return "Font";
    case "type-scale":
      return "Type scale";
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
        aria-labelledby="consistency-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="consistency-title" class="text-sm font-semibold text-slate-800">
              Kiểm tra nhất quán design system
            </h2>
            <p class="text-[11px] text-slate-400">
              Token spacing / type / radius / màu · breakpoint {{ modeLabel }} · chạy cục bộ
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

        <div class="flex items-center gap-2 border-b border-ds-border px-4 py-2 text-[11px]">
          <span class="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-600">
            {{ warnings }} lệch chuẩn
          </span>
          <span class="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
            {{ infos }} ghi chú
          </span>
          <span class="text-slate-400">
            {{ fixable.length }} mục có thể sửa tự động
          </span>
          <span
            v-if="appliedMessage"
            class="ml-auto rounded bg-emerald-50 px-2 py-0.5 text-emerald-600"
          >
            {{ appliedMessage }}
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <div
            v-if="issues.length === 0"
            class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-8 text-center"
          >
            <div class="text-2xl">✓</div>
            <p class="mt-2 text-sm font-medium text-emerald-700">
              Mọi style đang bám design system
            </p>
            <p class="mt-1 text-xs text-emerald-600">
              Không phát hiện giá trị spacing, typography, radius hay màu nào lệch token.
            </p>
          </div>

          <ul v-else class="space-y-2">
            <li
              v-for="issue in issues"
              :key="issue.id"
              class="rounded-lg border border-ds-border px-3 py-2"
            >
              <div class="flex items-start gap-2">
                <span
                  class="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                  :class="issue.severity === 'warning' ? 'bg-amber-500' : 'bg-slate-400'"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-xs font-semibold text-slate-800">
                      {{ ruleLabel(issue) }}
                    </span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px]"
                      :class="
                        issue.severity === 'warning'
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-slate-100 text-slate-500'
                      "
                    >
                      {{ issue.severity === "warning" ? "Lệch chuẩn" : "Ghi chú" }}
                    </span>
                    <span class="text-[10px] text-slate-400">
                      {{ issue.nodeLabel }} · {{ issue.nodeId }}
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-slate-700">{{ issue.message }}</p>
                  <p class="text-[11px] text-slate-400">{{ issue.suggestion }}</p>
                </div>
                <button
                  v-if="issue.fixStyles"
                  class="shrink-0 rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                  @click="applyFixes([issue])"
                >
                  Sửa
                </button>
              </div>
            </li>
          </ul>
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
            :disabled="fixable.length === 0"
            @click="applyFixes()"
          >
            Sửa tự động ({{ fixable.length }})
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
