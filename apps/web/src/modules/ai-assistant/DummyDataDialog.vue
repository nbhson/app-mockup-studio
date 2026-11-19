<script setup lang="ts">
// ---------------------------------------------------------------------------
// AI dummy data dialog (plan/07 3.7) — fills stats/table/chart and generic
// placeholder copy with believable demo content. The API works offline with a
// deterministic generator; this dialog previews every change before applying.
// ---------------------------------------------------------------------------
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  DummyDataChange,
  DummyDataResult,
} from "@ai-mockup-studio/shared-types";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

/** Components the backend can fill (mirrors the API allowlist). */
const SUPPORTED_TYPES = new Set([
  "dashboard.header",
  "dashboard.stats",
  "dashboard.chart",
  "dashboard.table",
  "basic.text",
  "basic.button",
  "basic.input",
  "basic.image",
  "formal.card",
  "formal.form",
  "layout.section",
]);

const doc = useDocumentStore();
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<DummyDataResult | null>(null);
const context = ref("");
const onlySelection = ref(false);
const applied = ref<string[]>([]);

const selectedTarget = computed(() => {
  const node = doc.selectedNode;
  return node && SUPPORTED_TYPES.has(node.type) ? node : null;
});
const selectedTargetLabel = computed(
  () => selectedTarget.value?.type.split(".").pop() ?? "",
);
const pending = computed(
  () => result.value?.changes.filter((change) => !applied.value.includes(change.nodeId)) ?? [],
);
const allApplied = computed(
  () => (result.value?.changes.length ?? 0) > 0 && pending.value.length === 0,
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Clear the previous run first (see DesignCritiqueDialog): a reopen
      // with no document must not show the old changes with dead Apply
      // buttons.
      result.value = null;
      applied.value = [];
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
    result.value = await api.post<DummyDataResult>("/ai/dummy-data", {
      document: doc.document,
      nodeId: onlySelection.value && selectedTarget.value ? selectedTarget.value.id : null,
      context: context.value.trim() || undefined,
      locale: "vi",
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tạo được dữ liệu mẫu";
  } finally {
    loading.value = false;
  }
}

function applyChanges(changes: DummyDataChange[] = pending.value) {
  if (!doc.document || changes.length === 0) return;
  const patches = changes.map((change) => ({
    op: "update" as const,
    targetId: change.nodeId,
    changes: Object.fromEntries(
      Object.entries(change.props).map(([key, value]) => [`props.${key}`, value]),
    ),
  }));

  try {
    const next = applyPatchBatch(doc.document, patches);
    doc.mutate(next, "Điền dữ liệu mẫu");
    applied.value = [...new Set([...applied.value, ...changes.map((change) => change.nodeId)])];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không áp dụng được dữ liệu mẫu";
  }
}

function toggleSelectionScope() {
  onlySelection.value = !onlySelection.value;
  void run();
}

function preview(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      const columns = (value[0] as unknown[]).length;
      return `${value.length} hàng × ${columns} cột`;
    }
    return value.map((item) => String(item)).join(" · ");
  }
  if (typeof value === "string") {
    return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  }
  return String(value ?? "—");
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
        aria-labelledby="dummy-data-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="dummy-data-title" class="text-sm font-semibold text-slate-800">
              Dữ liệu mẫu
            </h2>
            <p class="text-[11px] text-slate-400">
              Điền stats / bảng / biểu đồ và nội dung placeholder bằng dữ liệu thực tế
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
          <input
            v-model="context"
            class="min-w-0 flex-1 rounded-md border border-ds-border px-2 py-1 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-400"
            placeholder="Ngữ cảnh (tuỳ chọn): dashboard bán hàng, khách hàng…"
            maxlength="500"
            @keydown.enter.prevent="run"
          />
          <button
            v-if="selectedTarget"
            class="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              onlySelection
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-ds-border text-slate-500 hover:bg-slate-50'
            "
            :aria-pressed="onlySelection"
            :title="`Chỉ tạo cho node ${selectedTarget.id}`"
            @click="toggleSelectionScope"
          >
            Chỉ node đang chọn ({{ selectedTargetLabel }})
          </button>
          <button
            class="rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            :disabled="loading"
            @click="run"
          >
            ↻ Tạo lại
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <div v-if="loading" class="py-16 text-center">
            <div
              class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
            />
            <p class="mt-3 text-sm text-slate-500">Đang tạo dữ liệu mẫu…</p>
          </div>

          <div
            v-else-if="error"
            class="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center"
          >
            <p class="text-sm font-medium text-red-700">Không tạo được dữ liệu mẫu</p>
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
              v-if="result.changes.length === 0"
              class="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-8 text-center"
            >
              <div class="text-2xl">✓</div>
              <p class="mt-2 text-sm font-medium text-emerald-700">
                Không có thành phần nào cần điền
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
                  {{ result.source === "ai" ? `AI · ${result.model ?? "model"}` : "Dữ liệu cục bộ" }}
                </span>
                <span>{{ result.summary }}</span>
              </div>

              <ul class="space-y-2">
                <li
                  v-for="change in result.changes"
                  :key="change.nodeId"
                  class="rounded-lg border px-3 py-2"
                  :class="
                    applied.includes(change.nodeId)
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-ds-border'
                  "
                >
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-xs font-semibold text-slate-800">
                          {{ change.nodeLabel }}
                        </span>
                        <span class="text-[10px] text-slate-400">{{ change.nodeId }}</span>
                        <span
                          v-if="applied.includes(change.nodeId)"
                          class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700"
                        >
                          Đã áp dụng
                        </span>
                      </div>
                      <dl class="mt-1 space-y-0.5">
                        <div
                          v-for="(value, key) in change.props"
                          :key="key"
                          class="flex gap-1 text-[11px]"
                        >
                          <dt class="shrink-0 font-medium text-slate-500">{{ key }}:</dt>
                          <dd class="min-w-0 truncate text-slate-700">{{ preview(value) }}</dd>
                        </div>
                      </dl>
                    </div>
                    <button
                      v-if="!applied.includes(change.nodeId)"
                      class="shrink-0 rounded-md border border-ds-border px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                      @click="applyChanges([change])"
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
            @click="applyChanges()"
          >
            {{ allApplied ? "Đã áp dụng tất cả" : `Áp dụng tất cả (${pending.length})` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
