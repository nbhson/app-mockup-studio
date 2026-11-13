<script setup lang="ts">
// Left zone: component palette (drag → canvas) + layer tree (drag to re-parent).
import { computed } from "vue";
import { walkTree } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import {
  buildNodeFromType,
  componentPalette,
  useEditorStore,
} from "../../stores/editor";

const doc = useDocumentStore();
const editor = useEditorStore();

interface LayerRow {
  id: string;
  type: string;
  displayName: string;
  depth: number;
  isContainer: boolean;
}

const rows = computed<LayerRow[]>(() => {
  if (!doc.document) return [];
  const list: LayerRow[] = [];
  walkTree(doc.document.root, (node, _parent, depth) => {
    const type = node.type.split(".").pop() ?? node.type;
    const isRoot = node.id === doc.document!.root.id;
    list.push({
      id: node.id,
      type,
      displayName: isRoot ? node.name ?? "Root" : (node.props?.title as string) || (node.props?.label as string) || node.name || type,
      depth,
      isContainer: node.children instanceof Array,
    });
  });
  return list;
});

const rootId = computed(() => doc.document?.root.id ?? null);

function onPaletteDragStart(e: DragEvent, type: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData("application/x-mockup-component", type);
  e.dataTransfer.effectAllowed = "copy";
  editor.startDragNew(type);
}

function onLayerDragStart(e: DragEvent, id: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData("application/x-mockup-node", id);
  e.dataTransfer.effectAllowed = "move";
  editor.startDragMove(id);
}

function onDragEnd() {
  editor.clearDrag();
}

/** Click fallback: add into the selected container (or document root). */
function addComponent(type: string) {
  if (!doc.document) return;
  const selected = doc.selectedNode;
  const parentId =
    selected && selected.children !== undefined ? selected.id : doc.document.root.id;
  const node = buildNodeFromType(type);
  if (!node) return;
  doc.applyPatches(
    [{ op: "add", parentId, node }],
    `Thêm ${node.name ?? type}`,
  );
  doc.selectedId = node.id;
}
</script>

<template>
  <aside class="flex h-full w-60 flex-col border-r border-ds-border bg-white">
    <div class="shrink-0 border-b border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Components
    </div>
    <div class="grid max-h-56 shrink-0 grid-cols-2 gap-1.5 overflow-auto p-2">
      <button
        v-for="item in componentPalette"
        :key="item.type"
        draggable="true"
        class="cursor-grab rounded border border-ds-border px-2 py-1.5 text-left text-xs hover:border-blue-400 hover:bg-blue-50 active:cursor-grabbing"
        :title="`Kéo ${item.label} vào canvas (hoặc bấm để thêm)`"
        @dragstart="onPaletteDragStart($event, item.type)"
        @dragend="onDragEnd"
        @click="addComponent(item.type)"
      >
        <span class="block truncate font-medium text-slate-700">{{ item.label }}</span>
        <span class="block truncate font-mono text-[10px] text-slate-400">{{ item.type }}</span>
      </button>
    </div>

    <div class="shrink-0 border-y border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Layers
    </div>
    <div class="panel-scroll flex-1 overflow-auto p-2">
      <button
        v-for="row in rows"
        :key="row.id"
        :draggable="row.id !== rootId"
        class="group flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm"
        :class="doc.selectedId === row.id ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
        @dragstart="onLayerDragStart($event, row.id)"
        @dragend="onDragEnd"
        @click.stop="doc.selectedId = doc.selectedId === row.id ? null : row.id"
      >
        <span class="shrink-0 text-[10px] text-slate-400">
          {{ row.isContainer ? "▸" : "•" }}
        </span>
        <span class="font-mono text-[11px] text-slate-400">{{ row.type }}</span>
        <span class="truncate">{{ row.displayName }}</span>
      </button>
    </div>
  </aside>
</template>
