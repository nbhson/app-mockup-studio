<script setup lang="ts">
// Canvas comments dialog (plan/07 4.6). Threads are anchored to the selected
// node (or the whole page), support replies, and can be resolved/reopened.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CommentStatus, CommentThreadDto } from "@ai-mockup-studio/shared-types";
import { findNode } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import {
  commentAnchorLabel,
  commentSnippet,
  createComment,
  listComments,
  replyComment,
  setCommentStatus,
} from "../../services/comments";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();

type Filter = "open" | "resolved" | "all";

const threads = ref<CommentThreadDto[]>([]);
const filter = ref<Filter>("open");
const selectedThreadId = ref<string | null>(null);
const draft = ref("");
const replyDraft = ref("");
const loading = ref(false);
const submitting = ref(false);
const replying = ref(false);
const updatingId = ref<string | null>(null);
const error = ref<string | null>(null);
const author = ref(localStorage.getItem("comment-author") ?? "Demo User");

const anchorLabel = computed(() => commentAnchorLabel(doc.selectedNode));
const projectId = computed(() => doc.projectId);
const pageId = computed(() => doc.currentPageId);

const openCount = computed(
  () => threads.value.filter((thread) => thread.status === "open").length,
);

const filteredThreads = computed(() => {
  if (filter.value === "all") return threads.value;
  return threads.value.filter((thread) => thread.status === filter.value);
});

const selectedThread = computed(
  () => threads.value.find((thread) => thread.id === selectedThreadId.value) ?? null,
);

const canComment = computed(
  () =>
    Boolean(projectId.value && pageId.value) &&
    draft.value.trim().length > 0 &&
    !submitting.value,
);

const canReply = computed(
  () => Boolean(projectId.value) && replyDraft.value.trim().length > 0 && !replying.value,
);

const filters: { id: Filter; label: string }[] = [
  { id: "open", label: "Đang mở" },
  { id: "resolved", label: "Đã xong" },
  { id: "all", label: "Tất cả" },
];

function close() {
  error.value = null;
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function selectThread(thread: CommentThreadDto) {
  selectedThreadId.value = thread.id;
  replyDraft.value = "";
}

function ensureSelection() {
  const visible = filteredThreads.value;
  if (visible.some((thread) => thread.id === selectedThreadId.value)) return;
  selectedThreadId.value = visible[0]?.id ?? null;
  replyDraft.value = "";
}

async function load() {
  if (!projectId.value || !pageId.value) {
    threads.value = [];
    selectedThreadId.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const res = await listComments(projectId.value, pageId.value);
    threads.value = res.threads;
    ensureSelection();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tải được bình luận";
  } finally {
    loading.value = false;
  }
}

async function submitComment() {
  if (!canComment.value || !projectId.value || !pageId.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const node = doc.selectedNode;
    const thread = await createComment(projectId.value, {
      pageId: pageId.value,
      nodeId: node?.id,
      nodeLabel: node ? anchorLabel.value : undefined,
      body: draft.value.trim(),
      authorName: author.value.trim() || undefined,
    });
    threads.value = [thread, ...threads.value];
    draft.value = "";
    filter.value = "open";
    selectedThreadId.value = thread.id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không gửi được bình luận";
  } finally {
    submitting.value = false;
  }
}

async function submitReply() {
  const thread = selectedThread.value;
  if (!canReply.value || !projectId.value || !thread) return;
  replying.value = true;
  error.value = null;
  try {
    const updated = await replyComment(projectId.value, thread.id, {
      body: replyDraft.value.trim(),
      authorName: author.value.trim() || undefined,
    });
    replaceThread(updated);
    replyDraft.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không gửi được trả lời";
  } finally {
    replying.value = false;
  }
}

async function toggleStatus(thread: CommentThreadDto) {
  if (!projectId.value) return;
  const next: CommentStatus = thread.status === "open" ? "resolved" : "open";
  updatingId.value = thread.id;
  error.value = null;
  try {
    const updated = await setCommentStatus(projectId.value, thread.id, next);
    replaceThread(updated);
    ensureSelection();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không cập nhật được trạng thái";
  } finally {
    updatingId.value = null;
  }
}

function replaceThread(updated: CommentThreadDto) {
  threads.value = threads.value.map((thread) =>
    thread.id === updated.id ? updated : thread,
  );
}

function selectOnCanvas(thread: CommentThreadDto) {
  if (!thread.nodeId || !doc.document) return;
  if (!findNode(doc.document.root, thread.nodeId)) {
    error.value = "Element này không còn trong document hiện tại.";
    return;
  }
  doc.selectNode(thread.nodeId);
  close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
      draft.value = "";
      replyDraft.value = "";
      filter.value = "open";
      window.addEventListener("keydown", onKeydown);
      void load();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

watch(filter, ensureSelection);

watch(
  () => doc.currentPageId,
  () => {
    if (props.open) void load();
  },
);

watch(author, (value) => {
  localStorage.setItem("comment-author", value);
});

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
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
        aria-labelledby="comments-title"
        class="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div class="flex items-center gap-2">
            <h2 id="comments-title" class="text-sm font-semibold text-slate-800">
              💬 Bình luận & review
            </h2>
            <span
              class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
            >
              {{ openCount }} đang mở
            </span>
          </div>
          <button
            class="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Đóng (Esc)"
            @click="close"
          >
            ✕
          </button>
        </div>

        <div class="flex min-h-0 flex-1">
          <aside class="flex w-80 shrink-0 flex-col border-r border-ds-border bg-slate-50/60">
            <div class="border-b border-ds-border p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Bình luận mới
                </p>
                <span
                  class="max-w-44 truncate rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                  :title="anchorLabel"
                >
                  {{ anchorLabel }}
                </span>
              </div>
              <textarea
                v-model="draft"
                rows="3"
                class="mt-2 w-full resize-none rounded border border-ds-border bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                placeholder="Nhận xét về element đang chọn hoặc cả trang…"
                @keydown.meta.enter.prevent="submitComment"
                @keydown.ctrl.enter.prevent="submitComment"
              />
              <div class="mt-2 flex items-center justify-between gap-2">
                <input
                  v-model="author"
                  class="w-28 rounded border border-ds-border bg-white px-2 py-1 text-[11px] text-slate-600 outline-none focus:border-blue-400"
                  maxlength="80"
                  title="Tên hiển thị của bạn"
                  aria-label="Tên hiển thị"
                />
                <button
                  class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  :disabled="!canComment"
                  @click="submitComment"
                >
                  {{ submitting ? "Đang gửi…" : "Gửi" }}
                </button>
              </div>
            </div>

            <div class="flex gap-1 border-b border-ds-border px-2 py-2">
              <button
                v-for="item in filters"
                :key="item.id"
                class="rounded px-2 py-1 text-[11px] font-medium transition-colors"
                :class="
                  filter === item.id
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                    : 'text-slate-500 hover:bg-white'
                "
                :aria-pressed="filter === item.id"
                @click="filter = item.id"
              >
                {{ item.label }}
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-2">
              <p
                v-if="loading"
                class="px-2 py-6 text-center text-xs text-slate-400"
              >
                Đang tải bình luận…
              </p>
              <p
                v-else-if="filteredThreads.length === 0"
                class="px-2 py-6 text-center text-xs text-slate-400"
              >
                Chưa có bình luận nào trong mục này.
              </p>
              <button
                v-for="thread in filteredThreads"
                :key="thread.id"
                class="mb-1 w-full rounded border px-2 py-2 text-left transition-colors"
                :class="
                  selectedThreadId === thread.id
                    ? 'border-blue-200 bg-white shadow-sm'
                    : 'border-transparent hover:bg-white'
                "
                @click="selectThread(thread)"
              >
                <div class="flex items-center gap-1.5">
                  <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="thread.status === 'open' ? 'bg-amber-500' : 'bg-emerald-500'"
                  />
                  <span class="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
                    {{ thread.nodeLabel ?? "Toàn trang" }}
                  </span>
                  <span class="shrink-0 text-[10px] text-slate-400">
                    {{ thread.messages.length }} 💬
                  </span>
                </div>
                <p class="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
                  {{ commentSnippet(thread.messages.at(-1)?.body ?? "") }}
                </p>
                <p class="mt-1 text-[10px] text-slate-400">
                  {{ thread.messages.at(-1)?.authorName }} · {{ formatTime(thread.updatedAt) }}
                </p>
              </button>
            </div>
          </aside>

          <section class="flex min-w-0 flex-1 flex-col">
            <template v-if="selectedThread">
              <div class="flex items-center gap-2 border-b border-ds-border px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-semibold text-slate-700">
                    {{ selectedThread.nodeLabel ?? "Toàn trang" }}
                  </p>
                  <p class="text-[10px] text-slate-400">
                    {{ selectedThread.createdBy }} · {{ formatTime(selectedThread.createdAt) }}
                  </p>
                </div>
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  :class="
                    selectedThread.status === 'open'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700'
                  "
                >
                  {{ selectedThread.status === "open" ? "Đang mở" : "Đã giải quyết" }}
                </span>
                <button
                  v-if="selectedThread.nodeId"
                  class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  title="Chọn element này trên canvas"
                  @click="selectOnCanvas(selectedThread)"
                >
                  Chọn trên canvas
                </button>
                <button
                  class="rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                  :class="
                    selectedThread.status === 'open'
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'border border-ds-border text-slate-600 hover:bg-slate-50'
                  "
                  :disabled="updatingId === selectedThread.id"
                  @click="toggleStatus(selectedThread)"
                >
                  {{
                    updatingId === selectedThread.id
                      ? "…"
                      : selectedThread.status === "open"
                        ? "Đánh dấu xong"
                        : "Mở lại"
                  }}
                </button>
              </div>

              <div class="min-h-0 flex-1 space-y-3 overflow-auto bg-slate-50/40 p-4">
                <div
                  v-for="message in selectedThread.messages"
                  :key="message.id"
                  class="max-w-[85%] rounded-lg border border-ds-border bg-white px-3 py-2 shadow-sm"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-[11px] font-semibold text-slate-700">
                      {{ message.authorName }}
                    </p>
                    <p class="text-[10px] text-slate-400">
                      {{ formatTime(message.createdAt) }}
                    </p>
                  </div>
                  <p class="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                    {{ message.body }}
                  </p>
                </div>
              </div>

              <div class="border-t border-ds-border p-3">
                <textarea
                  v-model="replyDraft"
                  rows="2"
                  class="w-full resize-none rounded border border-ds-border px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
                  placeholder="Trả lời trong thread… (Ctrl/Cmd + Enter để gửi)"
                  @keydown.meta.enter.prevent="submitReply"
                  @keydown.ctrl.enter.prevent="submitReply"
                />
                <div class="mt-2 flex items-center justify-between">
                  <p class="text-[10px] text-slate-400">
                    {{ author || "Demo User" }}
                  </p>
                  <button
                    class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                    :disabled="!canReply"
                    @click="submitReply"
                  >
                    {{ replying ? "Đang gửi…" : "Trả lời" }}
                  </button>
                </div>
              </div>
            </template>

            <div
              v-else
              class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
            >
              <span class="text-2xl">💬</span>
              <p class="text-sm font-medium text-slate-600">
                {{ loading ? "Đang tải…" : "Chọn một thread để xem hội thoại" }}
              </p>
              <p class="max-w-xs text-[11px] leading-snug text-slate-400">
                Chọn element trên canvas rồi gửi bình luận đầu tiên để gắn nhận xét
                vào đúng component.
              </p>
            </div>
          </section>
        </div>

        <p
          v-if="error"
          class="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600"
        >
          {{ error }}
        </p>
      </div>
    </div>
  </Teleport>
</template>
