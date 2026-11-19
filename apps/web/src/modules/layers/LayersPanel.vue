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
import ComponentThumb from "./ComponentThumb.vue";
import ComponentRecommendDialog from "../analysis/ComponentRecommendDialog.vue";

const doc = useDocumentStore();
const editor = useEditorStore();

const showRecommend = ref(false);

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
  hidden: boolean;
  locked: boolean;
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
      hidden: Boolean(node.hidden),
      locked: Boolean(node.locked),
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
  if (row.locked) return;
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
  if (!root || row.parentId === null || row.locked) return;
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

/** Toggle visibility/lock through a normal undoable update command. */
function toggleLayerFlag(row: LayerRow, flag: "hidden" | "locked") {
  if (row.parentId === null) return;
  const current = flag === "hidden" ? row.hidden : row.locked;
  doc.applyPatches(
    [{ op: "update", targetId: row.id, changes: { [flag]: !current } }],
    flag === "hidden"
      ? current
        ? "Hiện layer"
        : "Ẩn layer"
      : current
        ? "Mở khóa layer"
        : "Khóa layer",
  );
}

function onPaletteDragStart(e: DragEvent, type: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData("application/x-mockup-component", type);
  e.dataTransfer.effectAllowed = "copy";
  editor.startDragNew(type);
}

function onLayerDragStart(e: DragEvent, row: LayerRow) {
  if (!e.dataTransfer || row.locked || row.parentId === null) return;
  e.dataTransfer.setData("application/x-mockup-node", row.id);
  e.dataTransfer.effectAllowed = "move";
  editor.startDragMove(row.id);
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
  <aside class="flex h-full w-60 flex-col border-r border-line bg-surface">
    <div class="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
      <span class="panel-title">Components</span>
      <button
        class="tb-btn tb-btn-accent"
        title="Gợi ý component tiếp theo bằng AI"
        @click="showRecommend = true"
      >
        ✨ Gợi ý
      </button>
    </div>
    <div class="shrink-0 border-b border-line p-2">
      <label class="sr-only" for="palette-search">Tìm component</label>
      <input
        id="palette-search"
        v-model="paletteQuery"
        type="search"
        placeholder="Tìm component…"
        class="field-input field-input-sm"
      />
    </div>
    <div class="max-h-64 shrink-0 overflow-auto p-2">
      <div
        v-for="group in paletteGroups"
        :key="group.category"
        class="mb-2 last:mb-0"
      >
        <div class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {{ group.label }}
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="item in group.items"
            :key="item.type"
            draggable="true"
            class="palette-card"
            :title="`Kéo ${item.label} vào canvas (hoặc bấm để thêm)`"
            @dragstart="onPaletteDragStart($event, item.type)"
            @dragend="onDragEnd"
            @click="addComponent(item.type)"
          >
            <ComponentThumb :type="item.type" />
            <span class="block truncate font-medium text-ink">{{ item.label }}</span>
            <span class="block truncate font-mono text-[10px] text-ink-muted">{{ item.type }}</span>
          </button>
        </div>
      </div>
      <p v-if="paletteGroups.length === 0" class="px-1 py-2 text-xs text-ink-muted">
        Không có component phù hợp.
      </p>
    </div>

    <div class="shrink-0 border-y border-line px-3 py-2 panel-title">
      Layers
    </div>
    <div class="panel-scroll flex-1 overflow-auto p-2">
      <div
        v-for="row in rows"
        :key="row.id"
        class="group flex w-full items-center gap-0.5 rounded text-sm transition-colors duration-150"
        :class="[
          doc.isSelected(row.id)
            ? 'bg-primary-soft text-primary-text'
            : 'text-ink hover:bg-surface-hover',
          row.hidden ? 'opacity-50' : '',
          row.locked ? 'text-ink-muted' : '',
        ]"
        :style="{ paddingLeft: `${4 + row.depth * 14}px` }"
      >
        <input
          v-if="renamingId === row.id"
          v-model="renameValue"
          data-rename-input
          class="field-input field-input-sm min-w-0 flex-1 text-sm!"
          @click.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <button
          v-else
          class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
          :draggable="row.id !== rootId && !row.locked"
          :title="
            row.locked
              ? `${row.displayName} — layer đang khóa`
              : `${row.displayName} — kéo để di chuyển, nhấp đôi để đổi tên`
          "
          @dragstart="onLayerDragStart($event, row)"
          @dragend="onDragEnd"
          @click.stop="onLayerClick($event, row.id)"
          @dblclick.stop="startRename(row)"
        >
          <span class="shrink-0 text-[10px] text-ink-muted">
            {{ row.isContainer ? "▸" : "•" }}
          </span>
          <span class="font-mono text-[11px] text-ink-muted">{{ row.type }}</span>
          <span class="truncate">{{ row.displayName }}</span>
        </button>
        <div
          v-if="row.parentId !== null && renamingId !== row.id"
          class="flex shrink-0 items-center transition-opacity"
          :class="
            row.hidden || row.locked
              ? ''
              : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          "
        >
          <button
            class="rounded p-0.5 text-ink-muted hover:bg-white hover:text-ink"
            :title="row.hidden ? 'Hiện layer' : 'Ẩn layer'"
            :aria-label="row.hidden ? 'Hiện layer' : 'Ẩn layer'"
            :aria-pressed="row.hidden"
            @click.stop="toggleLayerFlag(row, 'hidden')"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" />
              <circle cx="8" cy="8" r="2" />
              <path v-if="row.hidden" d="m2 2 12 12" />
            </svg>
          </button>
          <button
            class="rounded p-0.5 hover:bg-white hover:text-ink"
            :class="row.locked ? 'text-warning-text' : 'text-ink-muted'"
            :title="row.locked ? 'Mở khóa layer' : 'Khóa layer'"
            :aria-label="row.locked ? 'Mở khóa layer' : 'Khóa layer'"
            :aria-pressed="row.locked"
            @click.stop="toggleLayerFlag(row, 'locked')"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="7" width="10" height="6" rx="1" />
              <path
                :d="
                  row.locked
                    ? 'M5 7V5a3 3 0 0 1 6 0v2'
                    : 'M5 7V5a3 3 0 0 1 5.6-1.5'
                "
              />
            </svg>
          </button>
          <button
            class="rounded px-1 py-0.5 text-[10px] text-ink-muted hover:bg-white hover:text-ink disabled:opacity-30"
            :disabled="row.index === 0 || row.locked"
            title="Đưa layer lên"
            @click.stop="moveLayer(row, -1)"
          >
            ↑
          </button>
          <button
            class="rounded px-1 py-0.5 text-[10px] text-ink-muted hover:bg-white hover:text-ink disabled:opacity-30"
            :disabled="row.index >= row.siblingCount - 1 || row.locked"
            title="Đưa layer xuống"
            @click.stop="moveLayer(row, 1)"
          >
            ↓
          </button>
        </div>
      </div>
    </div>
    <ComponentRecommendDialog :open="showRecommend" @close="showRecommend = false" />
  </aside>
</template>
