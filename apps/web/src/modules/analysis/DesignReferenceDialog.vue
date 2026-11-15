<script setup lang="ts">
// ---------------------------------------------------------------------------
// Design reference dialog (plan/07 3.3) — upload a reference image, extract
// its dominant palette + theme tokens, tweak them manually, then apply the
// theme to the current document. Palette extraction uses canvas for every
// image format and the API decodes PNGs locally when no palette is sent.
// ---------------------------------------------------------------------------
import { onBeforeUnmount, ref, watch } from "vue";
import type { Theme } from "@ai-mockup-studio/ui-schema";
import type { DesignReferenceResult } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import { api } from "../../services/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

const doc = useDocumentStore();
const file = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<DesignReferenceResult | null>(null);
const theme = ref<Theme | null>(null);
const applied = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) {
      result.value = null;
      theme.value = null;
      applied.value = false;
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
  theme.value = null;
  applied.value = false;
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

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Extract dominant colors in the browser so JPEG/WebP also work. */
async function extractClientPalette(target: File): Promise<string[]> {
  try {
    const bitmap = await createImageBitmap(target);
    const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return [];
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 128) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((bucket) =>
        rgbToHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count),
      );
  } catch {
    return [];
  }
}

async function run() {
  if (!file.value || loading.value) return;
  loading.value = true;
  error.value = null;
  result.value = null;
  theme.value = null;
  applied.value = false;
  try {
    const palette = await extractClientPalette(file.value);
    const imageBase64 = await readFileAsDataUrl(file.value);
    const response = await api.post<DesignReferenceResult>("/ai/design-reference", {
      imageBase64,
      mimeType: file.value.type,
      palette: palette.length > 0 ? palette : undefined,
    });
    result.value = response;
    theme.value = { ...response.theme };
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không trích được bảng màu";
  } finally {
    loading.value = false;
  }
}

function apply() {
  if (!doc.document || !theme.value) return;
  doc.mutate({ ...doc.document, theme: { ...theme.value } }, "Áp design reference");
  applied.value = true;
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    background: "Nền",
    foreground: "Chữ",
    primary: "Chính",
  };
  return labels[role] ?? role;
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
        aria-labelledby="design-ref-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="design-ref-title" class="text-sm font-semibold text-slate-800">
              Design reference
            </h2>
            <p class="text-[11px] text-slate-400">
              Trích bảng màu từ ảnh mẫu, chỉnh token rồi áp vào mockup
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
              alt="Ảnh mẫu"
              class="max-h-52 max-w-full rounded border border-ds-border object-contain"
            />
            <template v-else>
              <span class="text-2xl">🎨</span>
              <span class="mt-2 text-sm font-medium text-slate-700">
                Chọn ảnh mẫu hoặc kéo thả vào đây
              </span>
              <span class="mt-1 text-[11px] text-slate-400">
                PNG, JPEG, WebP · tối đa 5 MB
              </span>
            </template>
          </label>

          <div class="mt-3 flex items-center justify-between gap-2">
            <span v-if="file" class="truncate text-[11px] text-slate-400">
              {{ file.name }} · {{ Math.round(file.size / 1024) }} KB
            </span>
            <button
              class="ml-auto shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="!file || loading"
              @click="run"
            >
              {{ loading ? "Đang trích…" : "Trích bảng màu" }}
            </button>
          </div>

          <div
            v-if="error"
            class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            {{ error }}
          </div>

          <template v-if="result && theme">
            <div class="mt-4 rounded-lg border border-ds-border p-3">
              <div class="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  class="rounded px-1.5 py-0.5 font-medium"
                  :class="
                    result.source === 'ai'
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-slate-100 text-slate-500'
                  "
                >
                  {{ result.source === "ai" ? `AI · ${result.model ?? "vision"}` : "Phân tích cục bộ" }}
                </span>
                <span class="text-slate-400">{{ result.summary }}</span>
              </div>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="color in result.palette"
                  :key="color.hex"
                  class="flex items-center gap-1.5 rounded border border-ds-border px-2 py-1"
                >
                  <span
                    class="h-6 w-6 rounded border border-slate-200"
                    :style="{ backgroundColor: color.hex }"
                  />
                  <span class="font-mono text-[10px] text-slate-600">{{ color.hex }}</span>
                  <span v-if="color.role" class="text-[10px] text-slate-400">
                    {{ roleLabel(color.role) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-2">
              <label class="text-[11px] text-slate-500">
                Mode
                <select v-model="theme.mode" class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs">
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label class="text-[11px] text-slate-500">
                Primary
                <input v-model="theme.primary" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Background
                <input v-model="theme.background" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Foreground
                <input v-model="theme.foreground" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Muted
                <input v-model="theme.muted" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Muted text
                <input v-model="theme.mutedForeground" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Border
                <input v-model="theme.border" type="color" class="mt-1 h-7 w-full rounded border border-ds-border" />
              </label>
              <label class="text-[11px] text-slate-500">
                Radius
                <input
                  v-model.number="theme.radius"
                  type="number"
                  min="0"
                  max="40"
                  class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs"
                />
              </label>
              <label class="col-span-2 text-[11px] text-slate-500">
                Font family
                <input
                  v-model="theme.fontFamily"
                  type="text"
                  class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs"
                />
              </label>
            </div>

            <p v-if="applied" class="mt-3 rounded bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              Đã áp theme vào mockup — Ctrl+Z để hoàn tác.
            </p>
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
            :disabled="!theme || !doc.document"
            @click="apply"
          >
            Áp dụng theme
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
