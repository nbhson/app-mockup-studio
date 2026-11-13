<script setup lang="ts">
// Canvas — center zone. Renders the current document via SchemaNode using the
// resolved element tree, and draws a selection outline over the chosen node.
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toPng, toSvg } from "html-to-image";
import { useDocumentStore } from "../../stores/document";
import { resolveNode, type ResolvedElement } from "@ai-mockup-studio/ui-renderer";
import { findNode } from "@ai-mockup-studio/ui-schema";
import { buildNodeFromType, useEditorStore } from "../../stores/editor";
import SchemaNode from "./SchemaNode.vue";
import AssetsDialog from "../assets/AssetsDialog.vue";
import ExportCodeDialog from "../export/ExportCodeDialog.vue";

const doc = useDocumentStore();
const editor = useEditorStore();
const router = useRouter();
const pageEl = ref<HTMLElement | null>(null);
const layoutTick = ref(0);
const showAssets = ref(false);
const showCode = ref(false);

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizePreview {
  width?: number;
  height?: number;
}

interface ResizeState {
  dir: ResizeDir;
  targetId: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const resizeState = ref<ResizeState | null>(null);
const resizePreview = ref<ResizePreview | null>(null);

const MIN_WIDTH = 24;
const MIN_HEIGHT = 16;

// --- Responsive preview (GĐ 5.3) --------------------------------------------
// Preview widths are transient UI state: switching device never mutates the
// document, so autosave does not fire. Desktop keeps the document's own width.
type PreviewDevice = "desktop" | "tablet" | "mobile";

interface DeviceOption {
  id: PreviewDevice;
  label: string;
  width: number | "document";
}

const deviceOptions: DeviceOption[] = [
  { id: "desktop", label: "Desktop", width: "document" },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "mobile", label: "Mobile", width: 390 },
];

const previewDevice = ref<PreviewDevice>("desktop");

const previewWidth = computed(() => {
  if (previewDevice.value === "desktop") {
    return doc.document?.viewport.width ?? 1280;
  }
  return (
    deviceOptions.find((d) => d.id === previewDevice.value)?.width ?? 1280
  ) as number;
});

// --- Export (GĐ 5.5) --------------------------------------------------------
type ExportFormat = "png" | "svg" | "json";

const exporting = ref<ExportFormat | null>(null);
const exportError = ref<string | null>(null);
const imageFormats: ("png" | "svg")[] = ["png", "svg"];

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "mockup"
  );
}

function download(filename: string, href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function exportImage(format: "png" | "svg") {
  const element = pageEl.value;
  if (!element || !doc.document || exporting.value) return;
  exporting.value = format;
  exportError.value = null;
  try {
    // Let pending layout changes (selection outline, preview width) settle.
    await nextTick();
    const options = {
      backgroundColor: "#ffffff",
      cacheBust: true,
      pixelRatio: format === "png" ? 2 : 1,
      // The selection outline / resize handles must not appear in exports.
      filter: (node: HTMLElement) => node.dataset?.exportIgnore === undefined,
    };
    const dataUrl =
      format === "png" ? await toPng(element, options) : await toSvg(element, options);
    const name = slugify(doc.document.name || "mockup");
    download(`mockup-${name}-${previewDevice.value}.${format}`, dataUrl);
  } catch (e) {
    exportError.value =
      e instanceof Error ? e.message : "Không xuất được ảnh";
  } finally {
    exporting.value = null;
  }
}

function exportJson() {
  if (!doc.document) return;
  exporting.value = "json";
  exportError.value = null;
  try {
    const blob = new Blob([JSON.stringify(doc.document, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    download(
      `mockup-${slugify(doc.document.name || "mockup")}.json`,
      url,
    );
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    exportError.value =
      e instanceof Error ? e.message : "Không xuất được JSON";
  } finally {
    exporting.value = null;
  }
}

const resizeHandles: { dir: ResizeDir; className: string }[] = [
  { dir: "nw", className: "left-[-4px] top-[-4px] cursor-nwse-resize" },
  { dir: "n", className: "left-1/2 top-[-4px] -translate-x-1/2 cursor-ns-resize" },
  { dir: "ne", className: "right-[-4px] top-[-4px] cursor-nesw-resize" },
  { dir: "w", className: "left-[-4px] top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { dir: "e", className: "right-[-4px] top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { dir: "sw", className: "bottom-[-4px] left-[-4px] cursor-nesw-resize" },
  { dir: "s", className: "bottom-[-4px] left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { dir: "se", className: "bottom-[-4px] right-[-4px] cursor-nwse-resize" },
];

const resolved = computed(() =>
  doc.document ? resolveNode(doc.document.root, doc.document.theme) : null,
);

/** Apply the transient resize preview to the rendered tree (not persisted). */
function withPreview(el: ResolvedElement): ResolvedElement {
  const preview = resizePreview.value;
  const targetId = resizeState.value?.targetId;
  const styles =
    preview && el.id === targetId
      ? {
          ...el.styles,
          ...(preview.width !== undefined ? { width: preview.width } : {}),
          ...(preview.height !== undefined ? { height: preview.height } : {}),
        }
      : el.styles;
  return {
    ...el,
    styles,
    children: el.children?.map(withPreview),
  };
}

const displayRoot = computed(() =>
  resolved.value ? withPreview(resolved.value) : null,
);

const canResize = computed(
  () =>
    Boolean(doc.selectedNode) &&
    doc.selectedId !== doc.document?.root.id &&
    !doc.isLoading,
);

const selectionRect = computed(() => {
  // Re-read the DOM after every document/selection change and on resize.
  void layoutTick.value;
  if (!doc.selectedId || !doc.document || !pageEl.value) return null;
  const el = document.querySelector(`[data-node-id="${CSS.escape(doc.selectedId)}"]`);
  if (!el) return null;
  // The outline lives inside the page element, so its coordinates must be
  // relative to the page — not to the outer scroll container.
  const er = el.getBoundingClientRect();
  const pr = pageEl.value.getBoundingClientRect();
  return {
    left: er.left - pr.left,
    top: er.top - pr.top,
    width: er.width,
    height: er.height,
  };
});

watch([() => doc.document, () => doc.selectedId], async () => {
  await nextTick();
  layoutTick.value += 1;
});

watch(resizePreview, async () => {
  await nextTick();
  layoutTick.value += 1;
});

watch(previewDevice, async () => {
  await nextTick();
  layoutTick.value += 1;
});

function onResize() {
  layoutTick.value += 1;
}

// --- Resize handles ---------------------------------------------------------

function cleanupResizeListeners() {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
  document.body.style.userSelect = "";
}

function startResize(e: PointerEvent, dir: ResizeDir) {
  if (!canResize.value || !selectionRect.value || !doc.selectedId) return;
  e.preventDefault();
  e.stopPropagation();

  const node = doc.selectedNode;
  const rect = selectionRect.value;
  resizeState.value = {
    dir,
    targetId: doc.selectedId,
    startX: e.clientX,
    startY: e.clientY,
    startWidth:
      typeof node?.styles?.width === "number" ? node.styles.width : rect.width,
    startHeight:
      typeof node?.styles?.height === "number" ? node.styles.height : rect.height,
  };

  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeEnd);
}

function onResizeMove(e: PointerEvent) {
  const state = resizeState.value;
  if (!state) return;

  const dx = e.clientX - state.startX;
  const dy = e.clientY - state.startY;
  const next: ResizePreview = {};

  if (state.dir.includes("e")) {
    next.width = Math.max(MIN_WIDTH, Math.round(state.startWidth + dx));
  }
  if (state.dir.includes("w")) {
    next.width = Math.max(MIN_WIDTH, Math.round(state.startWidth - dx));
  }
  if (state.dir.includes("s")) {
    next.height = Math.max(MIN_HEIGHT, Math.round(state.startHeight + dy));
  }
  if (state.dir.includes("n")) {
    next.height = Math.max(MIN_HEIGHT, Math.round(state.startHeight - dy));
  }
  resizePreview.value = next;
}

function onResizeEnd() {
  const state = resizeState.value;
  const preview = resizePreview.value;
  cleanupResizeListeners();
  resizeState.value = null;
  resizePreview.value = null;

  if (!state || !preview) return;
  const styles: Record<string, number> = {};
  if (preview.width !== undefined) styles.width = preview.width;
  if (preview.height !== undefined) styles.height = preview.height;
  if (Object.keys(styles).length === 0) return;

  doc.applyPatches(
    [{ op: "style", targetId: state.targetId, styles }],
    "Resize component",
  );
}

function cancelResize() {
  cleanupResizeListeners();
  resizeState.value = null;
  resizePreview.value = null;
}

function onSelect(id: string) {
  doc.selectedId = doc.selectedId === id ? null : id;
}

function onCanvasClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  // The click that follows a resize-handle drag must not clear the selection.
  if (target.closest("[data-resize]")) return;
  if (target.closest("[data-canvas]") && !target.closest("[data-node-id]")) {
    doc.selectedId = null;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  // Save works everywhere (including from an input).
  if (mod && key === "s") {
    e.preventDefault();
    void doc.save();
    return;
  }
  if (isTypingTarget(e.target)) return;

  if (e.key === "Escape") {
    if (resizeState.value) {
      cancelResize();
      return;
    }
    doc.selectedId = null;
  }
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
  } else if (mod && key === "y") {
    e.preventDefault();
    doc.redo();
  } else if (e.key === "Delete" && doc.selectedId) {
    const id = doc.selectedId;
    if (id === doc.document?.root.id) return;
    e.preventDefault();
    doc.applyPatches([{ op: "remove", targetId: id }], "Xóa component");
    doc.selectedId = null;
  }
}

/** Handle a drop on a container emitted by SchemaNode. */
function onDropOn(targetId: string) {
  const payload = editor.dragPayload;
  if (!payload || !doc.document) return;

  if (payload.kind === "new") {
    const node = buildNodeFromType(payload.type);
    if (!node) {
      editor.clearDrag();
      return;
    }
    doc.applyPatches(
      [{ op: "add", parentId: targetId, node }],
      `Thêm ${node.name ?? payload.type}`,
    );
    doc.selectedId = node.id;
  } else {
    const { nodeId } = payload;
    const moving = findNode(doc.document.root, nodeId);
    // Reject self-drop and moving a node into its own subtree.
    if (!moving || nodeId === targetId || findNode(moving, targetId)) {
      editor.clearDrag();
      return;
    }
    doc.applyPatches(
      [{ op: "move", targetId: nodeId, newParentId: targetId }],
      "Di chuyển component",
    );
    doc.selectedId = nodeId;
  }
  editor.clearDrag();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onResize);
  cleanupResizeListeners();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-ds-border bg-white/90 px-2 text-xs"
    >
      <button
        class="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        title="Quay lại danh sách dự án"
        @click="router.push('/projects')"
      >
        ← Dự án
      </button>

      <div class="mx-auto flex items-center gap-1">
        <button
          v-for="device in deviceOptions"
          :key="device.id"
          class="rounded px-2 py-1 font-medium transition-colors"
          :class="
            previewDevice === device.id
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-500 hover:bg-slate-100'
          "
          :aria-pressed="previewDevice === device.id"
          :title="`Xem trước ${device.label}`"
          @click="previewDevice = device.id"
        >
          {{ device.label }}
          <span class="ml-1 text-[10px] text-slate-400">
            {{ device.width === "document" ? previewWidth : device.width }}px
          </span>
        </button>
        <span
          v-if="previewDevice !== 'desktop'"
          class="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600"
          title="Chế độ xem trước — không lưu thay đổi viewport"
        >
          preview
        </span>
      </div>

      <div class="flex items-center gap-1">
        <span
          v-if="exportError"
          class="max-w-40 truncate text-[10px] text-red-500"
          :title="exportError"
        >
          {{ exportError }}
        </span>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="Xuất code HTML / React / Vue"
          @click="showCode = true"
        >
          Code
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="Thư viện ảnh của dự án"
          @click="showAssets = true"
        >
          🖼 Ảnh
        </button>
        <button
          v-for="fmt in imageFormats"
          :key="fmt"
          class="rounded px-2 py-1 font-medium uppercase text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="exporting !== null || !doc.document"
          :title="`Xuất ${fmt.toUpperCase()}`"
          @click="exportImage(fmt)"
        >
          {{ exporting === fmt ? "…" : fmt }}
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="exporting !== null || !doc.document"
          title="Xuất JSON UI Schema"
          @click="exportJson"
        >
          {{ exporting === "json" ? "…" : "JSON" }}
        </button>
      </div>
    </div>

    <div
      data-canvas
      class="relative min-h-0 flex-1 overflow-auto bg-slate-200/60"
      @click="onCanvasClick"
    >
      <div v-if="!doc.isLoading && doc.document" class="mx-auto my-8 w-fit">
        <div
          ref="pageEl"
          data-page
          class="relative bg-white shadow-sm"
          :style="{
            width: `${previewWidth}px`,
            minHeight: `${doc.document.viewport.height}px`,
            fontFamily: doc.document.theme.fontFamily,
          }"
        >
          <SchemaNode
            v-if="displayRoot"
            :element="displayRoot"
            :selectable="true"
            @select="onSelect"
            @drop-on="onDropOn"
          />

          <div
            v-if="selectionRect"
            data-export-ignore
            class="pointer-events-none absolute z-10 rounded-sm border-2 border-blue-500 ring-1 ring-blue-300"
            :style="{
              left: `${selectionRect.left}px`,
              top: `${selectionRect.top}px`,
              width: `${selectionRect.width}px`,
              height: `${selectionRect.height}px`,
            }"
          >
            <template v-if="canResize">
              <span
                v-for="handle in resizeHandles"
                :key="handle.dir"
                :data-resize="handle.dir"
                class="pointer-events-auto absolute h-2 w-2 rounded-sm border border-white bg-blue-500"
                :class="handle.className"
                @pointerdown.stop.prevent="startResize($event, handle.dir)"
              />
            </template>
          </div>
        </div>
      </div>

      <div v-if="doc.isLoading" class="mx-auto mt-20 w-fit text-sm text-slate-500">
        Đang tải…
      </div>
    </div>

    <AssetsDialog :open="showAssets" @close="showAssets = false" />
    <ExportCodeDialog :open="showCode" @close="showCode = false" />
  </div>
</template>
