import { defineStore } from "pinia";
import { ref } from "vue";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { createId, getComponentDefinition } from "@ai-mockup-studio/ui-schema";

// ---------------------------------------------------------------------------
// Component palette — for drag & drop on the canvas. In this MVP the palette
// is derived from the registry (source of truth) so it never drifts.
// ---------------------------------------------------------------------------

export interface PaletteItem {
  /** The registry type to insert. */
  type: string;
  label: string;
  category: string;
  isContainer: boolean;
}

export function buildPalette(): PaletteItem[] {
  // Dynamic import style not needed — registry is a plain object.
  // We re-scan via a small local copy of types to avoid bundler quirks.
  const types = [
    "layout.sidebar",
    "layout.navbar",
    "layout.container",
    "layout.section",
    "layout.grid",
    "dashboard.header",
    "dashboard.stats",
    "dashboard.chart",
    "dashboard.table",
    "basic.button",
    "basic.input",
    "basic.text",
    "basic.image",
    "formal.card",
    "formal.form",
  ] as const;
  return types.map((type) => {
    const def = getComponentDefinition(type);
    return {
      type,
      label: def?.label ?? type,
      category: def?.category ?? "basic",
      isContainer: def?.isContainer ?? false,
    };
  });
}

export const componentPalette = buildPalette();

/** Build a fresh UiNode for a palette type, ready to be added to the tree. */
export function buildNodeFromType(type: string): UiNode | null {
  const def = getComponentDefinition(type);
  if (!def) return null;
  return {
    id: createId(type.replace(/^[a-z]+\./, "")),
    type,
    name: def.label,
    props: { ...def.defaultProps },
    styles: def.defaultStyles ? { ...def.defaultStyles } : undefined,
    children: def.isContainer ? [] : undefined,
  };
}

// --- Editor state -----------------------------------------------------------

/**
 * The payload currently being dragged:
 *  - "new"  → a palette component that should be inserted into a container
 *  - "move" → an existing node being re-parented inside the canvas
 */
export type DragPayload =
  | { kind: "new"; type: string }
  | { kind: "move"; nodeId: string };

export const useEditorStore = defineStore("editor", () => {
  const dragPayload = ref<DragPayload | null>(null);

  /** Clipboard (P2.4 copy/paste): deep-cloned subtrees awaiting a paste. */
  const clipboard = ref<UiNode[]>([]);

  function setClipboard(nodes: UiNode[]) {
    clipboard.value = nodes.map((n) => JSON.parse(JSON.stringify(n)) as UiNode);
  }

  function clearClipboard() {
    clipboard.value = [];
  }

  function startDragNew(type: string) {
    dragPayload.value = { kind: "new", type };
  }

  function startDragMove(nodeId: string) {
    dragPayload.value = { kind: "move", nodeId };
  }

  function clearDrag() {
    dragPayload.value = null;
  }

  return {
    dragPayload,
    clipboard,
    setClipboard,
    clearClipboard,
    startDragNew,
    startDragMove,
    clearDrag,
  };
});
