<script setup lang="ts">
// Design-to-code dialog (plan/07 4.2). Generates a small component project
// (React/Vue/HTML + styles.css) from the current document, shows every file,
// and lets the user edit the output before copying/downloading it.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  exportDesignToCode,
  type DesignCodeBundle,
  type DesignCodeFile,
  type DesignCodeTarget,
} from "@ai-mockup-studio/ui-renderer";
import { useDocumentStore } from "../../stores/document";
import { collectAssetMap } from "../../services/document-assets";
import { copyText } from "../../services/clipboard";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();

const target = ref<DesignCodeTarget>("react");
const assetMap = ref<Record<string, string>>({});
const loadingAssets = ref(false);
const edits = ref<Record<string, string>>({});
const activePath = ref("");
const copiedPath = ref<string | null>(null);
const error = ref<string | null>(null);

const targets: { id: DesignCodeTarget; label: string }[] = [
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
  { id: "html", label: "HTML" },
];

const bundle = computed<DesignCodeBundle | null>(() => {
  if (!doc.document) return null;
  return exportDesignToCode(doc.document, target.value, {
    assetMap: assetMap.value,
    baseUrl: window.location.origin,
  });
});

const activeFile = computed<DesignCodeFile | null>(() => {
  const files = bundle.value?.files ?? [];
  return files.find((entry) => entry.path === activePath.value) ?? files[0] ?? null;
});

const activeContent = computed(() => {
  const file = activeFile.value;
  if (!file) return "";
  return edits.value[file.path] ?? file.content;
});

const dirty = computed(() => {
  const file = activeFile.value;
  if (!file) return false;
  return edits.value[file.path] !== undefined;
});

const lineCount = computed(() => activeContent.value.split("\n").length);

function close() {
  error.value = null;
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function resetEdits() {
  edits.value = {};
  copiedPath.value = null;
  activePath.value = bundle.value?.files[0]?.path ?? "";
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
      assetMap.value = {};
      resetEdits();
      window.addEventListener("keydown", onKeydown);
      if (doc.document) {
        loadingAssets.value = true;
        void collectAssetMap(doc.document.root)
          .then((map) => {
            assetMap.value = map;
          })
          .finally(() => {
            loadingAssets.value = false;
          });
      } else {
        loadingAssets.value = false;
      }
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

watch(target, () => resetEdits());

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function onInput(event: Event) {
  const file = activeFile.value;
  if (!file) return;
  edits.value = {
    ...edits.value,
    [file.path]: (event.target as HTMLTextAreaElement).value,
  };
}

function resetCurrent() {
  const file = activeFile.value;
  if (!file) return;
  const next = { ...edits.value };
  delete next[file.path];
  edits.value = next;
}

async function copyCurrent() {
  const file = activeFile.value;
  if (!file) return;
  error.value = null;
  const ok = await copyText(activeContent.value);
  if (!ok) {
    error.value = "Trình duyệt không cho phép copy tự động.";
    return;
  }
  copiedPath.value = file.path;
  setTimeout(() => {
    if (copiedPath.value === file.path) copiedPath.value = null;
  }, 1500);
}

function downloadFile(path: string, content: string) {
  const name = path.split("/").pop() ?? path;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCurrent() {
  const file = activeFile.value;
  if (!file) return;
  downloadFile(file.path, activeContent.value);
}

async function downloadAll() {
  if (!bundle.value) return;
  error.value = null;
  for (const file of bundle.value.files) {
    downloadFile(file.path, edits.value[file.path] ?? file.content);
    await new Promise((resolve) => setTimeout(resolve, 200));
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
        aria-labelledby="d2c-title"
        class="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="d2c-title" class="text-sm font-semibold text-slate-800">
              Design → Code
            </h2>
            <p class="text-[11px] text-slate-400">
              Component + CSS class + design token · chỉnh sửa được trước khi tải
            </p>
          </div>
          <div class="flex items-center gap-1">
            <button
              v-for="item in targets"
              :key="item.id"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                target === item.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-500 hover:bg-slate-100'
              "
              :aria-pressed="target === item.id"
              @click="target = item.id"
            >
              {{ item.label }}
            </button>
            <button
              class="ml-2 rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              title="Đóng (Esc)"
              @click="close"
            >
              ✕
            </button>
          </div>
        </div>

        <div v-if="!bundle" class="flex flex-1 items-center justify-center text-sm text-slate-500">
          Chưa có document để sinh code.
        </div>

        <div v-else class="flex min-h-0 flex-1">
          <aside class="flex w-56 shrink-0 flex-col border-r border-ds-border bg-slate-50/70">
            <div class="border-b border-ds-border px-3 py-2">
              <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Cấu trúc
              </p>
              <p class="mt-1 text-[11px] leading-snug text-slate-500">
                {{ bundle.summary }}
              </p>
              <p v-if="loadingAssets" class="mt-1 text-[10px] text-blue-600">
                Đang nhúng ảnh…
              </p>
            </div>
            <nav class="min-h-0 flex-1 overflow-auto p-2">
              <button
                v-for="file in bundle.files"
                :key="file.path"
                class="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors"
                :class="
                  activeFile?.path === file.path
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                    : 'text-slate-600 hover:bg-white'
                "
                :title="file.path"
                @click="activePath = file.path"
              >
                <span class="min-w-0 flex-1 truncate">{{ file.path }}</span>
                <span
                  v-if="edits[file.path] !== undefined"
                  class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                  title="Đã chỉnh sửa"
                />
              </button>
            </nav>
            <p class="border-t border-ds-border px-3 py-2 text-[10px] text-slate-400">
              {{ bundle.componentName }}
            </p>
          </aside>

          <section class="flex min-w-0 flex-1 flex-col">
            <div
              v-if="activeFile"
              class="flex items-center gap-2 border-b border-ds-border px-3 py-2"
            >
              <span class="truncate font-mono text-[11px] text-slate-600">
                {{ activeFile.path }}
              </span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                {{ activeFile.language }}
              </span>
              <span class="text-[10px] text-slate-400">{{ lineCount }} dòng</span>
              <span v-if="dirty" class="text-[10px] font-medium text-amber-600">
                đã sửa
              </span>
              <button
                v-if="dirty"
                class="ml-auto rounded px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100"
                @click="resetCurrent"
              >
                Hoàn tác file
              </button>
            </div>

            <textarea
              v-if="activeFile"
              :value="activeContent"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              class="min-h-0 flex-1 resize-none bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 outline-none"
              @input="onInput"
            />
          </section>
        </div>

        <p
          v-if="error"
          class="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600"
        >
          {{ error }}
        </p>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-ds-border px-4 py-2">
          <p class="text-[11px] text-slate-400">
            File tải xuống dùng tên rút gọn; giữ cấu trúc thư mục khi đưa vào dự án.
          </p>
          <div class="flex items-center gap-2">
            <button
              class="rounded border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              :disabled="!activeFile"
              @click="copyCurrent"
            >
              {{ copiedPath === activeFile?.path ? "Đã copy ✓" : "Copy file" }}
            </button>
            <button
              class="rounded border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              :disabled="!activeFile"
              @click="downloadCurrent"
            >
              Tải file
            </button>
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="!bundle"
              @click="downloadAll"
            >
              Tải tất cả
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
