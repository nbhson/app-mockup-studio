<script setup lang="ts">
// Left zone: component palette (drag → canvas) + layer tree (drag to re-parent).
import { computed, nextTick, ref } from "vue";
import { findNode, findParent, walkTree } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import {
  buildNodeFromType,
  componentPalette,
  useEditorStore,
  type PaletteItem,
} from "../../stores/editor";

const doc = useDocumentStore();
const editor = useEditorStore();

const paletteQuery = ref("");
const categoryLabels: Record<string, string> = {
  layout: "Layout",
  dashboard: "Dashboard",
  basic: "Basic",
  formal: "Formal",
};

const paletteGroups = computed(() => {
  const query = paletteQuery.value.trim().toLowerCase();
  const groups = new Map<string, PaletteItem[]>();
  for (const item of componentPalette) {
    if (
      query &&
      !`${item.label} ${item.type}`.toLowerCase().includes(query)
    ) {
      continue;
    }
    const items = groups.get(item.category) ?? [];
    items.push(item);
    groups.set(item.category, items);
  }
  return Array.from(groups, ([category, items]) => ({
    category,
    label: categoryLabels[category] ?? category,
    items,
  }));
});

interface LayerRow {
  id: string;
  type: string;
  displayName: string;
  depth: number;
  isContainer: boolean;
  parentId: string | null;
  index: number;
  siblingCount: number;
}

const rows = computed<LayerRow[]>(() => {
  if (!doc.document) return [];
  const list: LayerRow[] = [];
  const root = doc.document.root;
  // walkTree visits children in order, so a per-parent counter gives the
  // current index; a first pass records final sibling counts.
  const siblingCounts = new Map<string, number>();
  walkTree(root, (_node, parentId) => {
    if (!parentId) return;
    siblingCounts.set(parentId, (siblingCounts.get(parentId) ?? 0) + 1);
  });
  const counts = new Map<string, number>();
  walkTree(root, (node, parentId, depth) => {
    const key = parentId ?? "__root__";
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    const type = node.type.split(".").pop() ?? node.type;
    const isRoot = node.id === root.id;
    list.push({
      id: node.id,
      type,
      displayName:
        isRoot && !node.name
          ? "Root"
          : node.name ||
            (node.props?.title as string) ||
            (node.props?.label as string) ||
            type,
      depth,
      isContainer: node.children instanceof Array,
      parentId,
      index,
      siblingCount: parentId ? (siblingCounts.get(parentId) ?? 1) : 1,
    });
  });
  return list;
});

const rootId = computed(() => doc.document?.root.id ?? null);

const renamingId = ref<string | null>(null);
const renameValue = ref("");

function startRename(row: LayerRow) {
  renamingId.value = row.id;
  renameValue.value = row.displayName;
  void nextTick(() => {
    document
      .querySelector<HTMLInputElement>("[data-rename-input]")
      ?.select();
  });
}

function cancelRename() {
  renamingId.value = null;
  renameValue.value = "";
}

function commitRename() {
  const id = renamingId.value;
  const root = doc.document?.root;
  if (!id || !root) {
    cancelRename();
    return;
  }
  const name = renameValue.value.trim();
  cancelRename();
  if (!name || !findNode(root, id)) return;
  doc.applyPatches(
    [{ op: "update", targetId: id, changes: { name } }],
    "Đổi tên layer",
  );
}

/** Reorder within the current parent using the shared move command. */
function moveLayer(row: LayerRow, delta: number) {
  const root = doc.document?.root;
  if (!root || row.parentId === null) return;
  const holder = findParent(root, row.id);
  if (!holder) return;
  const nextIndex = holder.index + delta;
  const siblings = holder.parent.children ?? [];
  if (nextIndex < 0 || nextIndex >= siblings.length) return;
  doc.applyPatches(
    [
      {
        op: "move",
        targetId: row.id,
        newParentId: holder.parent.id,
        index: nextIndex,
      },
    ],
    delta < 0 ? "Đưa layer lên" : "Đưa layer xuống",
  );
}

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

function onLayerClick(e: MouseEvent, id: string) {
  if (e.ctrlKey || e.metaKey) {
    doc.selectNode(id, { additive: true });
    return;
  }
  // Keep the previous toggle behavior for the primary selection, but go
  // through the store so `selectedIds` stays in sync.
  if (doc.selectedId === id && doc.selectedIds.length === 1) {
    doc.clearSelection();
    return;
  }
  doc.selectNode(id);
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
  doc.setSelection([node.id], node.id);
}
</script>

<template>
  <aside class="flex h-full w-60 flex-col border-r border-ds-border bg-white">
    <div class="shrink-0 border-b border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Components
    </div>
    <div class="shrink-0 border-b border-ds-border p-2">
      <input
        v-model="paletteQuery"
        type="search"
        placeholder="Tìm component…"
        class="w-full rounded border border-ds-border px-2 py-1 text-xs"
      />
    </div>
    <div class="max-h-64 shrink-0 overflow-auto p-2">
      <div
        v-for="group in paletteGroups"
        :key="group.category"
        class="mb-2 last:mb-0"
      >
        <div class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {{ group.label }}
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="item in group.items"
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
      </div>
      <p v-if="paletteGroups.length === 0" class="px-1 py-2 text-xs text-slate-400">
        Không có component phù hợp.
      </p>
    </div>

    <div class="shrink-0 border-y border-ds-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      Layers
    </div>
    <div class="panel-scroll flex-1 overflow-auto p-2">
      <div
        v-for="row in rows"
        :key="row.id"
        class="group flex w-full items-center gap-0.5 rounded text-sm"
        :class="
          doc.isSelected(row.id)
            ? 'bg-blue-50 text-blue-700'
            : 'text-slate-700 hover:bg-slate-50'
        "
        :style="{ paddingLeft: `${4 + row.depth * 14}px` }"
      >
        <input
          v-if="renamingId === row.id"
          v-model="renameValue"
          data-rename-input
          class="min-w-0 flex-1 rounded border border-blue-400 px-1.5 py-0.5 text-sm"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <button
          v-else
          class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
          :draggable="row.id !== rootId"
          :title="`${row.displayName} — kéo để di chuyển, nhấp đôi để đổi tên`"
          @dragstart="onLayerDragStart($event, row.id)"
          @dragend="onDragEnd"
          @click.stop="onLayerClick($event, row.id)"
          @dblclick.stop="startRename(row)"
        >
          <span class="shrink-0 text-[10px] text-slate-400">
            {{ row.isContainer ? "▸" : "•" }}
          </span>
          <span class="font-mono text-[11px] text-slate-400">{{ row.type }}</span>
          <span class="truncate">{{ row.displayName }}</span>
        </button>
        <div
          v-if="row.parentId !== null && renamingId !== row.id"
          class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <button
            class="rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
            :disabled="row.index === 0"
            title="Đưa layer lên"
            @click.stop="moveLayer(row, -1)"
          >
            ↑
          </button>
          <button
            class="rounded px-1 py-0.5 text-[10px] text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"
            :disabled="row.index >= row.siblingCount - 1"
            title="Đưa layer xuống"
            @click.stop="moveLayer(row, 1)"
          >
            ↓
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
