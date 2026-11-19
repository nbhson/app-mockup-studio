<script setup lang="ts">
// Export code dialog (plan/07 4.1). Generates standalone HTML, a React component
// or a Vue SFC from the current document, inlining project images as data URLs.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  codeFileExtension,
  exportDocumentToCode,
  type CodeTarget,
} from "@ai-mockup-studio/ui-renderer";
import { useDocumentStore } from "../../stores/document";
import { collectAssetMap } from "../../services/document-assets";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const target = ref<CodeTarget>("html");
const assetMap = ref<Record<string, string>>({});
const loadingAssets = ref(false);
const actionError = ref<string | null>(null);
const copied = ref(false);

const targets: { id: CodeTarget; label: string; hint: string }[] = [
  { id: "html", label: "HTML", hint: "1 file, mở trực tiếp" },
  { id: "react", label: "React", hint: "Component .jsx" },
  { id: "vue", label: "Vue", hint: "SFC .vue" },
];

const PREVIEW_LIMIT = 20_000;

const code = computed(() => {
  if (!doc.document) return "";
  return exportDocumentToCode(doc.document, target.value, {
    assetMap: assetMap.value,
    baseUrl: window.location.origin,
  });
});

const preview = computed(() =>
  code.value.length > PREVIEW_LIMIT
    ? `${code.value.slice(0, PREVIEW_LIMIT)}\n\n… (còn ${code.value.length - PREVIEW_LIMIT} ký tự — tải file để xem đầy đủ)`
    : code.value,
);

const fileBase = computed(() => {
  const name = doc.document?.name ?? "mockup";
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "mockup"
  );
});

function close() {
  actionError.value = null;
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      actionError.value = null;
      copied.value = false;
      assetMap.value = {};
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

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

watch(target, () => {
  copied.value = false;
});

function download() {
  if (!code.value) return;
  actionError.value = null;
  try {
    const blob = new Blob([code.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mockup-${fileBase.value}.${codeFileExtension(target.value)}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : "Không tải được file code";
  }
}

async function copy() {
  actionError.value = null;
  let ok = false;

  // Prefer the async clipboard API (works on HTTPS/localhost); fall back to a
  // hidden textarea when the browser denies it (e.g. page not focused).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code.value);
      ok = true;
    }
  } catch {
    ok = false;
  }

  if (!ok) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = code.value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand("copy");
      textarea.remove();
    } catch {
      ok = false;
    }
  }

  if (ok) {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1500);
  } else {
    actionError.value = "Trình duyệt không cho phép copy tự động.";
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
        aria-labelledby="code-title"
        class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="code-title" class="text-sm font-semibold text-slate-800">
              Xuất code
            </h2>
            <p class="text-[11px] text-slate-400">
              Sinh từ UI Schema · style inline · không phụ thuộc thư viện
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

        <div class="flex items-center gap-1 border-b border-ds-border px-4 py-2">
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
            :title="item.hint"
            @click="target = item.id"
          >
            {{ item.label }}
          </button>
          <span class="ml-auto text-[11px] text-slate-400">
            {{ code.length.toLocaleString("vi-VN") }} ký tự
            <template v-if="loadingAssets"> · đang nhúng ảnh…</template>
            <template v-else-if="Object.keys(assetMap).length > 0">
              · {{ Object.keys(assetMap).length }} ảnh nhúng
            </template>
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto bg-slate-950 p-3">
          <pre class="whitespace-pre text-[11px] leading-relaxed text-slate-200"><code>{{ preview }}</code></pre>
        </div>

        <p v-if="actionError" class="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          {{ actionError }}
        </p>

        <div class="flex items-center justify-between border-t border-ds-border px-4 py-2">
          <p class="text-[11px] text-slate-400">
            File: mockup-{{ fileBase }}.{{ codeFileExtension(target) }}
          </p>
          <div class="flex items-center gap-2">
            <button
              class="rounded border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              @click="copy"
            >
              {{ copied ? "Đã copy ✓" : "Copy" }}
            </button>
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="!code || loadingAssets"
              @click="download"
            >
              Tải file
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
