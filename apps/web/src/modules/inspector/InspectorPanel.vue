<script setup lang="ts">
// Inspector — right zone. Lets the user edit width / height / color / padding
// and common props of the selected component. Every change goes through the
// document store (command manager) → undoable, versionable.
import { ref, watch } from "vue";
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
</script>

<template>
  <aside class="flex h-full w-64 flex-col border-l border-ds-border bg-white">
    <div class="shrink-0 border-b border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Properties
    </div>

    <div v-if="!doc.selectedNode" class="p-4 text-sm text-slate-400">
      Chọn một component trên canvas để chỉnh thuộc tính.
    </div>

    <div v-else class="panel-scroll flex-1 overflow-auto p-3">
      <div class="mb-3">
        <div class="text-sm font-medium text-slate-800">{{ doc.selectedNode.type }}</div>
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
  </aside>
</template>
