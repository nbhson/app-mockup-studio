<script setup lang="ts">
// ---------------------------------------------------------------------------
// Image-to-UI dialog (plan/07 3.1) — upload a screenshot, recreate it as an
// editable UiDocument. Uses the API vision model when configured and the local
// heuristic fallback otherwise. The result replaces the current canvas
// document (undoable with Ctrl+Z).
// ---------------------------------------------------------------------------
import { onBeforeUnmount, ref, watch } from "vue";
import type { ImageToUiResult } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

const doc = useDocumentStore();
const file = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const prompt = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<ImageToUiResult | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      result.value = null;
      error.value = null;
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  revokePreview();
});

function close() {
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function revokePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
}

function selectFile(next: File | null) {
  error.value = null;
  result.value = null;
  if (!next) return;
  if (!ACCEPTED.includes(next.type)) {
    error.value = "Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.";
    return;
  }
  if (next.size > MAX_BYTES) {
    error.value = `Ảnh vượt quá giới hạn ${MAX_BYTES / 1024 / 1024} MB.`;
    return;
  }
  revokePreview();
  file.value = next;
  previewUrl.value = URL.createObjectURL(next);
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectFile(input.files?.[0] ?? null);
  input.value = "";
}

function onDrop(event: DragEvent) {
  selectFile(event.dataTransfer?.files?.[0] ?? null);
}

function readFileAsDataUrl(target: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không đọc được tệp ảnh"));
    reader.readAsDataURL(target);
  });
}

async function run() {
  if (!file.value || loading.value) return;
  loading.value = true;
  error.value = null;
  result.value = null;
  // Pin the project/page the analysis was started on — the upload + vision
  // pass can outlive a project switch, and setDocument would then replace
  // the NEW project's canvas with the old context's result.
  const ctx = doc.captureContext();
  try {
    const imageBase64 = await readFileAsDataUrl(file.value);
    const response = await api.post<ImageToUiResult>("/ai/image-to-ui", {
      imageBase64,
      mimeType: file.value.type,
      prompt: prompt.value.trim() || undefined,
    });
    if (!doc.isContextCurrent(ctx)) {
      error.value =
        "Bạn đã chuyển trang/dự án trong lúc dựng mockup — kết quả không được áp dụng.";
      return;
    }
    doc.setDocument(response.document);
    result.value = response;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tạo được mockup từ ảnh";
  } finally {
    loading.value = false;
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
        aria-labelledby="image-to-ui-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="image-to-ui-title" class="text-sm font-semibold text-slate-800">
              Image → UI
            </h2>
            <p class="text-[11px] text-slate-400">
              Tải ảnh chụp màn hình và dựng lại thành mockup có thể chỉnh sửa
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
          <label
            class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-ds-border bg-slate-50/60 px-4 py-6 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40"
            @dragover.prevent
            @drop.prevent="onDrop"
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="onFileChange"
            />
            <img
              v-if="previewUrl"
              :src="previewUrl"
              alt="Ảnh xem trước"
              class="max-h-56 max-w-full rounded border border-ds-border object-contain"
            />
            <template v-else>
              <span class="text-2xl">🖼</span>
              <span class="mt-2 text-sm font-medium text-slate-700">
                Chọn ảnh hoặc kéo thả vào đây
              </span>
              <span class="mt-1 text-[11px] text-slate-400">
                PNG, JPEG, WebP · tối đa 5 MB
              </span>
            </template>
          </label>

          <div class="mt-3">
            <label class="mb-1 block text-[11px] font-medium text-slate-500">
              Mô tả thêm (không bắt buộc)
            </label>
            <input
              v-model="prompt"
              type="text"
              placeholder="vd: dashboard doanh thu, landing page sản phẩm…"
              class="w-full rounded border border-ds-border px-2 py-1.5 text-xs"
            />
          </div>

          <p
            v-if="file"
            class="mt-2 text-[11px] text-slate-400"
          >
            {{ file.name }} · {{ Math.round(file.size / 1024) }} KB
          </p>

          <div
            v-if="error"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            {{ error }}
          </div>

          <div
            v-if="result"
            class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                {{ result.source === "ai" ? `AI · ${result.model ?? "vision"}` : "Phân tích cục bộ" }}
              </span>
              <span class="text-[11px] text-emerald-700">
                {{ result.image.width }}×{{ result.image.height }}
              </span>
              <span class="text-[11px] text-emerald-700">
                Đã áp dụng vào canvas — Ctrl+Z để hoàn tác
              </span>
            </div>
            <p class="mt-1 text-xs text-emerald-700">{{ result.summary }}</p>
          </div>
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
            :disabled="!file || loading"
            @click="run"
          >
            {{ loading ? "Đang dựng mockup…" : "Tạo mockup từ ảnh" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
