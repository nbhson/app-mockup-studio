<script setup lang="ts">
// Canvas — center zone. Renders the current document via SchemaNode using the
// resolved element tree, and draws selection outlines over chosen nodes.
// Supports multi-select (P2.3), copy/paste (P2.4), duplicate page (P2.11).
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { toPng, toSvg } from "html-to-image";
import { useDocumentStore, topMostIds } from "../../stores/document";
import { useEditorStore } from "../../stores/editor";
import { useProjectsStore } from "../../stores/projects";
import { resolveNode, type ResolvedElement } from "@ai-mockup-studio/ui-renderer";
import { findNode, findParent, type ViewportMode } from "@ai-mockup-studio/ui-schema";
import { buildNodeFromType } from "../../stores/editor";
import { cloneWithNewIds } from "./clone-nodes";
import SchemaNode from "./SchemaNode.vue";
import AssetsDialog from "../assets/AssetsDialog.vue";
import ExportCodeDialog from "../export/ExportCodeDialog.vue";
import AccessibilityDialog from "../analysis/AccessibilityDialog.vue";
import ConsistencyDialog from "../analysis/ConsistencyDialog.vue";
import DesignCritiqueDialog from "../analysis/DesignCritiqueDialog.vue";
import ResponsiveOptimizeDialog from "../analysis/ResponsiveOptimizeDialog.vue";
import ImageToUiDialog from "../analysis/ImageToUiDialog.vue";
import UrlToUiDialog from "../analysis/UrlToUiDialog.vue";
import DummyDataDialog from "../ai-assistant/DummyDataDialog.vue";

const doc = useDocumentStore();
const editor = useEditorStore();
const projects = useProjectsStore();
const router = useRouter();
const pageEl = ref<HTMLElement | null>(null);
const layoutTick = ref(0);
const showAssets = ref(false);
const showCode = ref(false);
const showA11y = ref(false);
const showConsistency = ref(false);
const showCritique = ref(false);
const showDummyData = ref(false);
const showResponsive = ref(false);
const showImageToUi = ref(false);
const showUrlToUi = ref(false);

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizePreview {
  width?: number;
  height?: number;
}

interface ResizeState {
  dir: ResizeDir;
  targetId: string;
  mode: ViewportMode;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const resizeState = ref<ResizeState | null>(null);
const resizePreview = ref<ResizePreview | null>(null);

// --- Marquee selection (P2.3) ----------------------------------------------
interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const marqueeRect = ref<MarqueeRect | null>(null);
let marqueeStart: { x: number; y: number } | null = null;
let suppressCanvasClick = false;

const MIN_WIDTH = 24;
const MIN_HEIGHT = 16;

// --- Responsive preview (GĐ 5.3) --------------------------------------------
// Preview widths are transient UI state: switching device never mutates the
// document. Edits made while previewing tablet/mobile are stored as breakpoint
// overrides (`responsive.tablet/mobile`) instead of touching the base styles.
type PreviewDevice = ViewportMode;

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

const previewDevice = computed(() => doc.viewportMode);

const previewWidth = computed(() => {
  if (previewDevice.value === "desktop") {
    return doc.document?.viewport.width ?? 1280;
  }
  return (
    deviceOptions.find((d) => d.id === previewDevice.value)?.width ?? 1280
  ) as number;
});

/** Design tokens applied to the page: Tailwind utilities read these custom
 *  properties, so editing a token updates every component that uses it. */
const pageThemeStyle = computed<Record<string, string>>(() => {
  const theme = doc.document?.theme;
  if (!theme) return {};
  const style: Record<string, string> = {
    backgroundColor: theme.background,
    color: theme.foreground,
    fontFamily: theme.fontFamily,
    "--color-ds-primary": theme.primary,
    "--color-ds-background": theme.background,
    "--color-ds-foreground": theme.foreground,
    "--color-ds-muted": theme.muted,
    "--color-ds-muted-foreground": theme.mutedForeground,
    "--color-ds-border": theme.border,
  };
  return style;
});

// --- Export (GĐ 5.5) --------------------------------------------------------
type ExportFormat = "png" | "svg" | "json";

const exporting = ref<ExportFormat | null>(null);
const exportError = ref<string | null>(null);
const duplicating = ref(false);
const duplicateError = ref<string | null>(null);
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
  doc.document
    ? resolveNode(
        doc.document.root,
        doc.document.theme,
        undefined,
        doc.viewportMode,
      )
    : null,
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
    !doc.selectedNode?.locked &&
    !doc.selectedNode?.hidden &&
    !doc.isLoading,
);

function nodeRect(id: string): { left: number; top: number; width: number; height: number } | null {
  if (!pageEl.value) return null;
  const el = document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
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
}

const selectionRect = computed(() => {
  // Re-read the DOM after every document/selection change and on resize.
  void layoutTick.value;
  if (!doc.selectedId || !doc.document) return null;
  return nodeRect(doc.selectedId);
});

/** Thin outlines for the remaining (non-primary) selected nodes (P2.3). */
const secondarySelectionRects = computed(() => {
  void layoutTick.value;
  if (!doc.document) return [];
  return doc.selectedIds
    .filter((id) => id !== doc.selectedId)
    .map((id) => nodeRect(id))
    .filter((r): r is { left: number; top: number; width: number; height: number } => r !== null);
});

watch([() => doc.document, () => doc.selectedId, () => doc.selectedIds], async () => {
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
  const mode = doc.viewportMode;
  const effective = {
    ...(node?.styles ?? {}),
    ...(mode === "desktop" ? {} : (node?.responsive?.[mode] ?? {})),
  };
  resizeState.value = {
    dir,
    targetId: doc.selectedId,
    mode,
    startX: e.clientX,
    startY: e.clientY,
    startWidth:
      typeof effective.width === "number" ? effective.width : rect.width,
    startHeight:
      typeof effective.height === "number" ? effective.height : rect.height,
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

  if (state.mode === "desktop") {
    doc.applyPatches(
      [{ op: "style", targetId: state.targetId, styles }],
      "Resize component",
    );
    return;
  }
  // Responsive preview: resizing writes a breakpoint override, leaving the
  // desktop/base styles untouched.
  const changes: Record<string, number> = {};
  for (const [key, value] of Object.entries(styles)) {
    changes[`responsive.${state.mode}.${key}`] = value;
  }
  doc.applyPatches(
    [{ op: "update", targetId: state.targetId, changes }],
    `Resize component (${state.mode})`,
  );
}

function cancelResize() {
  cleanupResizeListeners();
  resizeState.value = null;
  resizePreview.value = null;
}

function onSelect(payload: { id: string; additive: boolean }) {
  // The pointerup that ends a marquee selection is followed by a click on the
  // node under the cursor; ignore it so it does not replace the marquee set.
  if (suppressCanvasClick) {
    suppressCanvasClick = false;
    return;
  }
  doc.selectNode(payload.id, { additive: payload.additive });
}

function pointInPage(e: PointerEvent): { x: number; y: number } | null {
  const page = pageEl.value;
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizedRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): MarqueeRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function intersects(a: MarqueeRect, b: MarqueeRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function cleanupMarquee() {
  marqueeStart = null;
  marqueeRect.value = null;
  window.removeEventListener("pointermove", onMarqueeMove);
  window.removeEventListener("pointerup", onMarqueeEnd);
  document.body.style.userSelect = "";
}

function cancelMarquee() {
  cleanupMarquee();
}

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !doc.document) return;
  const page = pageEl.value;
  const target = e.target as HTMLElement;
  if (!page || !page.contains(target)) return;
  // Resize handles own the pointer; form controls keep native behaviour.
  if (target.closest("[data-resize]")) return;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return;
  const start = pointInPage(e);
  if (!start) return;

  // A plain click on the background stays a click (handled by onClick);
  // dragging turns it into a marquee selection.
  marqueeStart = start;
  marqueeRect.value = { left: start.x, top: start.y, width: 0, height: 0 };
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMarqueeMove);
  window.addEventListener("pointerup", onMarqueeEnd);
}

function onMarqueeMove(e: PointerEvent) {
  if (!marqueeStart || !pageEl.value) return;
  const point = pointInPage(e);
  if (!point) return;
  const end = {
    x: clamp(point.x, 0, pageEl.value.clientWidth),
    y: clamp(point.y, 0, pageEl.value.clientHeight),
  };
  marqueeRect.value = normalizedRect(marqueeStart, end);
}

function selectNodesInMarquee(rect: MarqueeRect) {
  const page = pageEl.value;
  const root = doc.document?.root;
  if (!page || !root) return;

  const pageRect = page.getBoundingClientRect();
  const candidates: string[] = [];
  for (const el of page.querySelectorAll<HTMLElement>("[data-node-id]")) {
    const id = el.dataset.nodeId;
    if (!id || id === root.id) continue;
    // Locked layers are not selectable on the canvas (unlock via Layers).
    if (findNode(root, id)?.locked) continue;
    const nodeRect = el.getBoundingClientRect();
    const relative: MarqueeRect = {
      left: nodeRect.left - pageRect.left,
      top: nodeRect.top - pageRect.top,
      width: nodeRect.width,
      height: nodeRect.height,
    };
    if (intersects(rect, relative)) candidates.push(id);
  }

  const selected = topMostIds(root, candidates);
  if (selected.length === 0) doc.clearSelection();
  else doc.setSelection(selected);
}

function onMarqueeEnd() {
  const rect = marqueeRect.value;
  const wasDrag = Boolean(rect && (rect.width >= 4 || rect.height >= 4));
  cleanupMarquee();
  if (!wasDrag || !rect) return;

  // The browser fires click right after pointerup; do not let that click
  // immediately clear the selection we just made.
  suppressCanvasClick = true;
  window.setTimeout(() => {
    suppressCanvasClick = false;
  }, 0);
  selectNodesInMarquee(rect);
}

/** Ctrl/Cmd+A: select the children of the current container (or siblings of
 *  the current leaf), not the root, so Delete cannot remove the page itself. */
function selectAllSiblings() {
  const root = doc.document?.root;
  if (!root) return;
  let container = doc.selectedNode;
  while (container && container.children === undefined) {
    container = findParent(root, container.id)?.parent ?? null;
  }
  const target = container ?? root;
  const ids = (target.children ?? [])
    .filter((child) => !child.locked)
    .map((child) => child.id)
    .filter((id) => id !== root.id);
  doc.setSelection(ids);
}

function onCanvasClick(e: MouseEvent) {
  if (suppressCanvasClick) {
    suppressCanvasClick = false;
    return;
  }
  const target = e.target as HTMLElement;
  // The click that follows a resize-handle drag must not clear the selection.
  if (target.closest("[data-resize]")) return;
  if (target.closest("[data-canvas]") && !target.closest("[data-node-id]")) {
    doc.clearSelection();
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
    if (marqueeStart) {
      cancelMarquee();
      return;
    }
    if (resizeState.value) {
      cancelResize();
      return;
    }
    doc.clearSelection();
  }
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
  } else if (mod && key === "y") {
    e.preventDefault();
    doc.redo();
  } else if (mod && key === "a") {
    e.preventDefault();
    selectAllSiblings();
  } else if ((e.key === "Delete" || e.key === "Backspace") && doc.selectedIds.length > 0) {
    if (doc.selectedIds.includes(doc.document?.root.id ?? "")) return;
    e.preventDefault();
    doc.removeNodes([...doc.selectedIds]);
  } else if (mod && key === "c" && doc.selectedIds.length > 0) {
    e.preventDefault();
    editor.setClipboard(doc.selectedNodes);
  } else if (mod && key === "v" && editor.clipboard.length > 0) {
    e.preventDefault();
    pasteClipboard();
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
    doc.setSelection([node.id], node.id);
  } else {
    const { nodeId } = payload;
    // Dropping a node onto itself is meaningless (and would detach it).
    if (nodeId === targetId) {
      editor.clearDrag();
      return;
    }
    // Dragging any node of a multi-selection moves the whole group (P2.3).
    const group =
      doc.selectedIds.includes(nodeId) && doc.selectedIds.length > 1
        ? doc.selectedIds
        : [nodeId];
    doc.moveNodes(group, targetId);
  }
  editor.clearDrag();
}

/** Resolve where a pasted/duplicated node should be inserted: the primary
 *  selected container, or its parent when the selection is a leaf, else root. */
function insertionParent(): string {
  const root = doc.document?.root;
  if (!root) return "";
  let parentId = root.id;
  const primary = doc.selectedNode;
  if (primary && primary.id !== root.id) {
    const container = primary.children !== undefined
      ? primary
      : findParent(root, primary.id)?.parent;
    if (container && container.id !== root.id) parentId = container.id;
  }
  return parentId;
}

/** Paste (Ctrl+V): clone the clipboard into the current insertion point. */
function pasteClipboard() {
  if (!doc.document || editor.clipboard.length === 0) return;
  const parentId = insertionParent();
  const clones = cloneWithNewIds(editor.clipboard);
  doc.applyPatches(
    clones.map((node) => ({ op: "add" as const, parentId, node })),
    `Dán ${clones.length} component`,
  );
  doc.setSelection(clones.map((n) => n.id), clones[clones.length - 1]?.id ?? null);
}

/** Duplicate the current page (P2.11). The MVP stores one page per project,
 *  so this creates an independent project and opens it. Unsaved edits are
 *  flushed first; assets are copied server-side with rewritten URLs. */
async function duplicateProject() {
  if (!doc.projectId || duplicating.value) return;
  duplicating.value = true;
  duplicateError.value = null;
  try {
    if (doc.isDirty) {
      await doc.save();
      if (doc.isDirty || doc.saveError) {
        throw new Error(doc.saveError ?? "Không lưu được thay đổi trước khi nhân bản");
      }
    }
    const copy = await projects.duplicate(doc.projectId);
    await router.push(`/workspace/${copy.id}`);
  } catch (e) {
    duplicateError.value =
      e instanceof Error ? e.message : "Không nhân bản được dự án";
  } finally {
    duplicating.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", onResize);
  cleanupResizeListeners();
  cleanupMarquee();
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
          @click="doc.setViewportMode(device.id)"
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
          v-if="exportError || duplicateError"
          class="max-w-40 truncate text-[10px] text-red-500"
          :title="exportError ?? duplicateError ?? ''"
        >
          {{ exportError ?? duplicateError }}
        </span>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document || duplicating || doc.isSaving"
          :title="
            doc.isDirty
              ? 'Lưu thay đổi rồi nhân bản trang thành dự án mới'
              : 'Nhân bản trang thành dự án mới (giữ schema và ảnh)'
          "
          @click="duplicateProject"
        >
          {{ duplicating ? "…" : "⧉ Nhân bản trang" }}
        </button>
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
          title="Điền dữ liệu mẫu cho stats, bảng, biểu đồ và nội dung placeholder"
          @click="showDummyData = true"
        >
          🧪 Dữ liệu mẫu
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          title="Dựng mockup từ ảnh chụp màn hình"
          @click="showImageToUi = true"
        >
          🖼 Ảnh → UI
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          title="Dựng mockup từ một trang web công khai"
          @click="showUrlToUi = true"
        >
          🔗 URL → UI
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="Đề xuất override tablet/mobile an toàn"
          @click="showResponsive = true"
        >
          📐 Responsive
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="AI đánh giá thiết kế: hierarchy, spacing, contrast, token"
          @click="showCritique = true"
        >
          ✨ Critique
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="Kiểm tra accessibility theo WCAG AA"
          @click="showA11y = true"
        >
          ♿ Kiểm tra
        </button>
        <button
          class="rounded px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          :disabled="!doc.document"
          title="Kiểm tra style lệch design token"
          @click="showConsistency = true"
        >
          🎨 Nhất quán
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
      @pointerdown="onCanvasPointerDown"
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
            ...pageThemeStyle,
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
            v-for="rect in secondarySelectionRects"
            :key="`${rect.left}x${rect.top}`"
            data-export-ignore
            class="pointer-events-none absolute z-10 border border-dashed border-blue-400"
            :style="{
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            }"
          />

          <div
            v-if="marqueeRect"
            data-export-ignore
            class="pointer-events-none absolute z-20 border border-blue-500 bg-blue-500/10"
            :style="{
              left: `${marqueeRect.left}px`,
              top: `${marqueeRect.top}px`,
              width: `${marqueeRect.width}px`,
              height: `${marqueeRect.height}px`,
            }"
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
    <AccessibilityDialog :open="showA11y" @close="showA11y = false" />
    <ConsistencyDialog :open="showConsistency" @close="showConsistency = false" />
    <DesignCritiqueDialog :open="showCritique" @close="showCritique = false" />
    <DummyDataDialog :open="showDummyData" @close="showDummyData = false" />
    <ResponsiveOptimizeDialog :open="showResponsive" @close="showResponsive = false" />
    <ImageToUiDialog :open="showImageToUi" @close="showImageToUi = false" />
    <UrlToUiDialog :open="showUrlToUi" @close="showUrlToUi = false" />
  </div>
</template>
