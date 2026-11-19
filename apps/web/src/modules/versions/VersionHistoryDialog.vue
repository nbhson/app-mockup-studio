<script setup lang="ts">
// Version history dialog (plan/12 GĐ 5.2) — lists server snapshots, lets the
// user restore one, and compares a snapshot with the document open in the
// editor (P2.10 diff cơ bản). Restoring snapshots the current state first, so
// the action is itself reversible from this timeline.
import { onBeforeUnmount, ref, watch } from "vue";
import type {
  VersionDetailResponse,
  VersionSummaryDto,
} from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";
import { diffDocuments, type DocumentDiff } from "./diff-document";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const confirmId = ref<string | null>(null);
const actionError = ref<string | null>(null);

const compareId = ref<string | null>(null);
const comparing = ref(false);
const diff = ref<DocumentDiff | null>(null);
const diffError = ref<string | null>(null);

const formatter = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "medium",
});

function formatDate(iso: string): string {
  return formatter.format(new Date(iso));
}

function resetCompare() {
  compareId.value = null;
  comparing.value = false;
  diff.value = null;
  diffError.value = null;
}

function close() {
  confirmId.value = null;
  resetCompare();
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      confirmId.value = null;
      actionError.value = null;
      resetCompare();
      window.addEventListener("keydown", onKeydown);
      void doc.loadVersions();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

async function restore(id: string) {
  actionError.value = null;
  try {
    await doc.restoreVersion(id);
    close();
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : "Khôi phục thất bại";
  }
}

/** Compare a snapshot against what is currently open (snapshot → current). */
async function compare(version: VersionSummaryDto) {
  if (compareId.value === version.id) {
    resetCompare();
    return;
  }
  if (!doc.projectId || !doc.document) return;
  compareId.value = version.id;
  comparing.value = true;
  diff.value = null;
  diffError.value = null;
  try {
    const detail = await api.get<VersionDetailResponse>(
      `/projects/${doc.projectId}/versions/${version.id}`,
    );
    // Ignore a response that arrived after the user switched/closed the diff.
    if (compareId.value !== version.id) return;
    diff.value = diffDocuments(detail.document, doc.document);
  } catch (e) {
    if (compareId.value === version.id) {
      diffError.value =
        e instanceof Error ? e.message : "Không tải được bản so sánh";
    }
  } finally {
    if (compareId.value === version.id) comparing.value = false;
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
        aria-labelledby="versions-title"
        class="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="versions-title" class="text-sm font-semibold text-slate-800">
              Lịch sử phiên bản
            </h2>
            <p class="text-[11px] text-slate-400">
              Snapshot tự động mỗi 5 phút và trước mỗi lần khôi phục
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

        <div class="min-h-0 flex-1 overflow-auto p-2">
          <p v-if="doc.versionsLoading" class="py-8 text-center text-sm text-slate-400">
            Đang tải lịch sử…
          </p>
          <p v-else-if="doc.versionsError" class="px-2 py-6 text-center text-sm text-red-500">
            {{ doc.versionsError }}
          </p>
          <p v-else-if="doc.versions.length === 0" class="px-2 py-8 text-center text-sm text-slate-400">
            Chưa có bản lưu nào. Hệ thống sẽ tự tạo sau khi bạn chỉnh sửa.
          </p>
          <ul v-else class="space-y-1">
            <li
              v-for="(version, index) in doc.versions"
              :key="version.id"
              class="rounded-md border border-transparent px-2 py-2 hover:border-ds-border hover:bg-slate-50"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-medium text-slate-700">
                      {{ index === 0 ? "Mới nhất" : `Bản ${doc.versions.length - index}` }}
                    </span>
                    <span
                      v-if="version.note"
                      class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                    >
                      {{ version.note }}
                    </span>
                  </div>
                  <p class="text-[11px] text-slate-400">{{ formatDate(version.createdAt) }}</p>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <button
                    class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                    :title="
                      compareId === version.id
                        ? 'Ẩn so sánh'
                        : 'So sánh bản này với nội dung đang mở'
                    "
                    :aria-expanded="compareId === version.id"
                    @click="compare(version)"
                  >
                    {{ compareId === version.id ? "Ẩn" : "So sánh" }}
                  </button>
                  <template v-if="confirmId === version.id">
                    <button
                      class="rounded bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      :disabled="doc.isRestoring"
                      @click="restore(version.id)"
                    >
                      {{ doc.isRestoring ? "Đang khôi phục…" : "Xác nhận" }}
                    </button>
                    <button
                      class="rounded border border-ds-border px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      :disabled="doc.isRestoring"
                      @click="confirmId = null"
                    >
                      Hủy
                    </button>
                  </template>
                  <button
                    v-else
                    class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                    title="Khôi phục phiên bản này"
                    @click="confirmId = version.id"
                  >
                    Khôi phục
                  </button>
                </div>
              </div>

              <div
                v-if="compareId === version.id"
                class="mt-2 rounded bg-slate-50 p-2 text-[11px]"
              >
                <p v-if="comparing" class="text-slate-500">Đang tải bản so sánh…</p>
                <p v-else-if="diffError" class="text-red-500">{{ diffError }}</p>
                <template v-else-if="diff">
                  <p v-if="!diff.hasChanges" class="text-slate-500">
                    Không có khác biệt so với bản đang mở.
                  </p>
                  <template v-else>
                    <div class="mb-1 flex flex-wrap gap-1">
                      <span
                        v-if="diff.added.length"
                        class="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
                      >
                        +{{ diff.added.length }} node
                      </span>
                      <span
                        v-if="diff.removed.length"
                        class="rounded bg-red-50 px-1.5 py-0.5 text-red-600"
                      >
                        −{{ diff.removed.length }} node
                      </span>
                      <span
                        v-if="diff.changed.length"
                        class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                      >
                        ~{{ diff.changed.length }} sửa
                      </span>
                      <span
                        v-if="diff.themeChanged"
                        class="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700"
                      >
                        theme
                      </span>
                    </div>
                    <ul class="space-y-0.5 text-slate-500">
                      <li v-for="item in diff.changed.slice(0, 4)" :key="`c-${item.id}`">
                        ~ {{ item.name }} ({{ item.fields.join(", ") }})
                      </li>
                      <li v-for="item in diff.added.slice(0, 3)" :key="`a-${item.id}`">
                        + {{ item.name }}
                      </li>
                      <li v-for="item in diff.removed.slice(0, 3)" :key="`r-${item.id}`">
                        − {{ item.name }}
                      </li>
                    </ul>
                    <p
                      v-if="
                        diff.changed.length + diff.added.length + diff.removed.length > 10
                      "
                      class="mt-1 text-slate-400"
                    >
                      … và các thay đổi khác
                    </p>
                  </template>
                </template>
              </div>
            </li>
          </ul>
          <p
            v-if="doc.versions.length >= 50"
            class="px-2 pt-2 text-center text-[11px] text-slate-400"
          >
            Chỉ hiển thị 50 phiên bản gần nhất.
          </p>
        </div>

        <p v-if="actionError" class="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          {{ actionError }}
        </p>
        <p class="border-t border-ds-border px-4 py-2 text-[11px] text-slate-400">
          Khôi phục sẽ thay thế nội dung hiện tại. Trạng thái trước đó vẫn được lưu trong lịch sử.
        </p>
      </div>
    </div>
  </Teleport>
</template>
