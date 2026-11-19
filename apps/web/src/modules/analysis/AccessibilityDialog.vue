<script setup lang="ts">
// ---------------------------------------------------------------------------
// Accessibility dialog (plan/07 3.6) — lists WCAG AA findings for the current
// document/breakpoint and applies safe style fixes through the command manager.
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDocumentStore } from "../../stores/document";
import {
  analyzeAccessibility,
  applyAccessibilityFixes,
  type AccessibilityIssue,
} from "./accessibility";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const appliedMessage = ref<string | null>(null);

const issues = computed<AccessibilityIssue[]>(() =>
  doc.document ? analyzeAccessibility(doc.document, doc.viewportMode) : [],
);
const errors = computed(() => issues.value.filter((i) => i.severity === "error").length);
const warnings = computed(() => issues.value.filter((i) => i.severity === "warning").length);
const fixable = computed(() => issues.value.filter((i) => i.fixStyles));
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

function applyFixes(selected: AccessibilityIssue[] = issues.value) {
  if (!doc.document) return;
  const next = applyAccessibilityFixes(doc.document, selected, doc.viewportMode);
  if (!next) return;
  doc.mutate(next, "Sửa lỗi accessibility");
  appliedMessage.value = `Đã áp dụng ${selected.filter((i) => i.fixStyles).length} sửa đổi.`;
}

function severityLabel(issue: AccessibilityIssue): string {
  return issue.severity === "error" ? "Lỗi" : "Cảnh báo";
}

function ruleLabel(issue: AccessibilityIssue): string {
  switch (issue.rule) {
    case "contrast":
      return "Tương phản";
    case "missing-alt":
      return "Thiếu alt";
    case "missing-label":
      return "Thiếu nhãn";
    case "small-text":
      return "Chữ nhỏ";
    case "small-target":
      return "Vùng bấm nhỏ";
  }
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
        aria-labelledby="a11y-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="a11y-title" class="text-sm font-semibold text-slate-800">
              Kiểm tra accessibility
            </h2>
            <p class="text-[11px] text-slate-400">
              WCAG AA · breakpoint {{ modeLabel }} · chạy cục bộ, không gọi AI
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
          <span class="rounded bg-red-50 px-2 py-0.5 font-medium text-red-600">
            {{ errors }} lỗi
          </span>
          <span class="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-600">
            {{ warnings }} cảnh báo
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
              Không phát hiện lỗi accessibility
            </p>
            <p class="mt-1 text-xs text-emerald-600">
              Tài liệu hiện tại đạt các kiểm tra tương phản, nhãn, cỡ chữ và vùng bấm.
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
                  :class="issue.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-xs font-semibold text-slate-800">
                      {{ ruleLabel(issue) }}
                    </span>
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px]"
                      :class="
                        issue.severity === 'error'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-amber-50 text-amber-600'
                      "
                    >
                      {{ severityLabel(issue) }}
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
