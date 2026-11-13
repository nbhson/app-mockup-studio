<script setup lang="ts">
// Inspector — right zone. Lets the user edit width / height / color / padding
// and common props of the selected component. Every change goes through the
// document store (command manager) → undoable, versionable.
//
// The Design tokens section edits the document theme globally: Tailwind
// utilities on the page read the CSS custom properties set by the canvas, and
// the renderer derives button/radius colors from the same theme.
import { computed, ref, watch } from "vue";
import type { Theme } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";

const doc = useDocumentStore();

const width = ref<number | null>(null);
const height = ref<number | null>(null);
const padding = ref<number | null>(null);
const color = ref<string | null>(null);

watch(
  () => doc.selectedNode,
  (node) => {
    width.value = typeof node?.styles?.width === "number" ? (node.styles.width as number) : null;
    height.value = typeof node?.styles?.height === "number" ? (node.styles.height as number) : null;
    padding.value = typeof node?.styles?.padding === "number" ? (node.styles.padding as number) : null;
    color.value = (node?.styles?.color as string) ?? (node?.styles?.backgroundColor as string) ?? null;
  },
  { immediate: true },
);

function commit(styles: Record<string, unknown>, description: string) {
  if (!doc.document || !doc.selectedId) return;
  const patches = [
    {
      op: "style" as const,
      targetId: doc.selectedId,
      styles,
    },
  ];
  // Reuse the shared patch application to build the next immutable document,
  // then hand it to the store (which records it as a command).
  const next = applyPatchBatch(doc.document, patches);
  doc.mutate(next, description);
}

function onWidth(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  commit({ width: v }, "Sửa width");
}

function onHeight(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  commit({ height: v }, "Sửa height");
}

function onPadding(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  commit({ padding: v }, "Sửa padding");
}

function onColor(e: Event) {
  commit({ color: (e.target as HTMLInputElement).value }, "Sửa màu chữ");
}

// --- Design tokens (P2.7) ---------------------------------------------------

const theme = computed<Theme | null>(() => doc.document?.theme ?? null);

const colorTokens: { key: keyof Theme; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "border", label: "Border" },
];

function commitTheme(partial: Partial<Theme>, description: string) {
  if (!doc.document) return;
  doc.mutate(
    {
      ...doc.document,
      theme: { ...doc.document.theme, ...partial },
    },
    description,
  );
}

function onThemeColor(key: keyof Theme, e: Event) {
  const value = (e.target as HTMLInputElement).value.trim();
  if (!value) return;
  commitTheme({ [key]: value } as Partial<Theme>, "Đổi design token");
}

function onRadius(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v) || v < 0) return;
  commitTheme({ radius: v }, "Đổi bo góc");
}

function onFontFamily(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim();
  if (!v) return;
  commitTheme({ fontFamily: v }, "Đổi font chữ");
}

function onMode(e: Event) {
  const mode = (e.target as HTMLSelectElement).value === "dark" ? "dark" : "light";
  if (mode === "dark") {
    commitTheme(
      {
        mode,
        background: "#0F172A",
        foreground: "#F8FAFC",
        muted: "#1E293B",
        mutedForeground: "#94A3B8",
        border: "#334155",
      },
      "Đổi theme tối",
    );
  } else {
    commitTheme(
      {
        mode,
        background: "#FFFFFF",
        foreground: "#0F172A",
        muted: "#F1F5F9",
        mutedForeground: "#64748B",
        border: "#E2E8F0",
      },
      "Đổi theme sáng",
    );
  }
}
</script>

<template>
  <aside class="flex h-full w-64 flex-col border-l border-ds-border bg-white">
    <div class="shrink-0 border-b border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Properties
    </div>

    <div class="panel-scroll min-h-0 flex-1 overflow-auto p-3">
      <p v-if="!doc.selectedNode" class="text-sm text-slate-400">
        Chọn một component trên canvas để chỉnh thuộc tính.
      </p>

      <div v-else>
        <div class="mb-3">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium text-slate-800">{{ doc.selectedNode.type }}</span>
            <span
              v-if="doc.selectedNode.locked"
              class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600"
            >
              đã khóa
            </span>
            <span
              v-if="doc.selectedNode.hidden"
              class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              đang ẩn
            </span>
          </div>
          <div class="text-xs text-slate-400">id: {{ doc.selectedNode.id }}</div>
        </div>

        <div class="space-y-3 text-sm">
          <label class="block">
            <span class="mb-1 block text-xs text-slate-500">Width (px)</span>
            <input
              :value="width ?? ''"
              type="number"
              class="w-full rounded-md border border-ds-border px-2 py-1.5"
              placeholder="auto"
              @change="onWidth"
            />
          </label>

          <label class="block">
            <span class="mb-1 block text-xs text-slate-500">Height (px)</span>
            <input
              :value="height ?? ''"
              type="number"
              class="w-full rounded-md border border-ds-border px-2 py-1.5"
              placeholder="auto"
              @change="onHeight"
            />
          </label>

          <label class="block">
            <span class="mb-1 block text-xs text-slate-500">Padding (px)</span>
            <input
              :value="padding ?? ''"
              type="number"
              class="w-full rounded-md border border-ds-border px-2 py-1.5"
              placeholder="auto"
              @change="onPadding"
            />
          </label>

          <div v-if="color">
            <span class="mb-1 block text-xs text-slate-500">Color</span>
            <input
              :value="color"
              type="color"
              class="h-8 w-full rounded-md border border-ds-border"
              @change="onColor"
            />
          </div>
        </div>
      </div>

      <div v-if="theme" class="mt-4 border-t border-ds-border pt-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Design tokens
          </span>
          <span class="text-[10px] text-slate-400">áp dụng toàn cục</span>
        </div>

        <label class="mb-2 block">
          <span class="mb-1 block text-xs text-slate-500">Theme</span>
          <select
            :value="theme.mode"
            class="w-full rounded-md border border-ds-border px-2 py-1.5 text-sm"
            @change="onMode"
          >
            <option value="light">Sáng</option>
            <option value="dark">Tối</option>
          </select>
        </label>

        <div class="mb-2 grid grid-cols-2 gap-2">
          <label
            v-for="token in colorTokens"
            :key="token.key"
            class="block"
            :title="`${token.label}: ${theme[token.key]}`"
          >
            <span class="mb-1 block text-[10px] text-slate-500">{{ token.label }}</span>
            <span class="flex items-center gap-1">
              <input
                :value="theme[token.key]"
                type="color"
                class="h-6 w-6 shrink-0 cursor-pointer rounded border border-ds-border bg-white p-0"
                @change="onThemeColor(token.key, $event)"
              />
              <input
                :value="theme[token.key]"
                type="text"
                spellcheck="false"
                class="min-w-0 flex-1 rounded border border-ds-border px-1 py-0.5 font-mono text-[10px]"
                @change="onThemeColor(token.key, $event)"
              />
            </span>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-xs text-slate-500">Radius (px)</span>
            <input
              :value="theme.radius"
              type="number"
              min="0"
              class="w-full rounded-md border border-ds-border px-2 py-1.5 text-sm"
              @change="onRadius"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-slate-500">Font</span>
            <input
              :value="theme.fontFamily"
              type="text"
              class="w-full rounded-md border border-ds-border px-2 py-1.5 text-xs"
              @change="onFontFamily"
            />
          </label>
        </div>
      </div>
    </div>
  </aside>
</template>
