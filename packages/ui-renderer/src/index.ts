// ---------------------------------------------------------------------------
// ui-renderer — framework-agnostic mapping from UiNode to a renderable element
// description. The Vue canvas consumes this to mount components; a future
// HTML/SVG/React exporter could reuse the exact same mapping (plan/07 4.1).
//
// Design rule (plan/01): the renderer must NEVER execute code from AI. It only
// reads structured data (UiNode) and resolves it against the component
// registry — so arbitrary JS/HTML from the model is simply never executed.
// ---------------------------------------------------------------------------

import {
  getComponentDefinition,
  isKnownComponentType,
  type UiNode,
  type UiPatch,
  type UiDocument,
  type Theme,
  type ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { defaultTokens, type DesignTokens } from "@ai-mockup-studio/design-system";

/** A resolved, immutable element description the framework can render. */
export interface ResolvedElement {
  id: string;
  type: string;
  known: boolean;
  label: string;
  isContainer: boolean;
  /** Hidden/locked flags are editor state carried through resolution. */
  hidden?: boolean;
  locked?: boolean;
  /** Merged props: definition defaults overridden by node.props. */
  props: Record<string, unknown>;
  /** Merged styles: definition defaultStyles + node.styles + theme-derived. */
  styles: Record<string, unknown>;
  children?: ResolvedElement[];
}

/** Resolve a UiNode using the component registry + theme + tokens.
 *  `viewport` selects the breakpoint override merged on top of the base styles
 *  (desktop = base styles only). */
export function resolveNode(
  node: UiNode,
  theme: Theme = defaultTheme(),
  tokens: DesignTokens = defaultTokens,
  viewport: ViewportMode = "desktop",
): ResolvedElement {
  const def = getComponentDefinition(node.type);
  const override =
    viewport === "desktop" ? undefined : node.responsive?.[viewport];
  const styles: Record<string, unknown> = {
    ...(def?.defaultStyles ?? {}),
    ...(node.styles ?? {}),
    ...(override ?? {}),
  };
  if (node.type === "basic.button") {
    styles.backgroundColor = styles.backgroundColor ?? theme.primary;
    styles.color = styles.color ?? theme.primaryForeground;
  }
  if (node.type === "layout.sidebar") {
    styles.backgroundColor = styles.backgroundColor ?? theme.muted;
  }
  // Design-token radius (P2.7): components using their registry default radius
  // follow the document token; an explicitly overridden radius still wins.
  const defaultRadius = def?.defaultStyles?.borderRadius;
  const explicitRadius = override?.borderRadius ?? node.styles?.borderRadius;
  if (
    typeof styles.borderRadius === "number" &&
    (explicitRadius === undefined || explicitRadius === defaultRadius)
  ) {
    styles.borderRadius = theme.radius;
  }

  return {
    id: node.id,
    type: node.type,
    known: isKnownComponentType(node.type),
    label: def?.label ?? node.type,
    isContainer: def?.isContainer ?? false,
    hidden: node.hidden,
    locked: node.locked,
    props: { ...(def?.defaultProps ?? {}), ...(node.props ?? {}) },
    styles,
    // A registry-declared NON-container (image, button, ...) renders no
    // children — matching the HTML/React/Vue exporters, which drop them.
    // Unknown types (imported library components) keep their children.
    children:
      def && !def.isContainer
        ? undefined
        : node.children?.map((c) => resolveNode(c, theme, tokens, viewport)),
  };
}

export function resolveDocument(
  doc: UiDocument,
  viewport: ViewportMode = "desktop",
): ResolvedElement {
  return resolveNode(doc.root, doc.theme, defaultTokens, viewport);
}

export function defaultTheme(): Theme {
  const c = defaultTokens.colors;
  return {
    mode: "light",
    primary: c.primary,
    primaryForeground: c.primaryForeground,
    background: c.background,
    foreground: c.foreground,
    muted: c.muted,
    mutedForeground: c.mutedForeground,
    border: c.border,
    fontFamily: defaultTokens.typography.fontFamily,
    radius: defaultTokens.radius.md,
  };
}

// ---------------------------------------------------------------------------
// Patch application — safe immutable mutation of a document (clone first).
// Used by the command manager (_after_ AI validation) and backend replay.
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Change keys for `update` patches are dot-paths resolved against the NODE
// object. Only editor-safe paths may be written; everything else (structural
// fields, prototype accessors like "__proto__" / "constructor") is rejected so
// a malicious AI/model response can never pollute Object.prototype or rewrite
// the tree through props-style keys.
const SAFE_CHANGE_ROOTS = new Set([
  "props",
  "styles",
  "responsive",
  "name",
  "hidden",
  "locked",
  "text",
]);
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeChangeKey(key: string): void {
  const parts = key.split(".");
  if (parts.length === 0 || !SAFE_CHANGE_ROOTS.has(parts[0])) {
    throw new Error(
      `applyPatch.update: change key "${key}" must start with props./styles./responsive. or be one of ${[...SAFE_CHANGE_ROOTS].join(", ")}`,
    );
  }
  for (const part of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(part)) {
      throw new Error(`applyPatch.update: change key "${key}" is forbidden`);
    }
  }
}

function resolveChanges(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(changes)) {
    assertSafeChangeKey(key);
    const parts = key.split(".");
    let cursor: Record<string, unknown> = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      // Only OWN properties may be traversed — never prototype-chain values.
      const next = Object.prototype.hasOwnProperty.call(cursor, part)
        ? cursor[part]
        : undefined;
      if (typeof next !== "object" || next === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    // Every segment (including the leaf) was validated above, and traversal
    // only follows own properties, so this assignment can never reach
    // Object.prototype.
    cursor[parts[parts.length - 1]] = value;
  }
}

function findNode(root: UiNode, id: string, seen: Set<UiNode> = new Set()): UiNode | null {
  if (seen.has(root)) return null;
  seen.add(root);
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id, seen);
    if (found) return found;
  }
  return null;
}

function forEachTree(
  root: UiNode,
  visit: (node: UiNode) => void,
  seen: Set<UiNode> = new Set(),
): void {
  // Cycle guard: an in-memory tree must never contain a node twice, but a
  // detached reference (see `move` guards) must not turn into an infinite loop.
  if (seen.has(root)) return;
  seen.add(root);
  visit(root);
  for (const child of root.children ?? []) forEachTree(child, visit, seen);
}

function assertNonNegativeIndex(op: string, index: number | undefined): void {
  if (index !== undefined && index < 0) {
    throw new Error(`applyPatch.${op}: index must be >= 0, got ${index}`);
  }
}

function applyOnePatch(doc: UiDocument, patch: UiPatch): void {
  const root = doc.root;
  switch (patch.op) {
    case "add": {
      assertNonNegativeIndex("add", patch.index);
      const parent = findNode(root, patch.parentId);
      if (!parent) throw new Error(`applyPatch.add: parent "${patch.parentId}" not found`);
      const parentDef = getComponentDefinition(parent.type);
      if (parentDef && !parentDef.isContainer) {
        throw new Error(
          `applyPatch.add: parent "${patch.parentId}" (type ${parent.type}) is not a container`,
        );
      }
      parent.children = parent.children ?? [];
      const node = deepClone(patch.node);
      const newIds = collectIds(node);
      if (newIds.has(patch.parentId)) {
        throw new Error(`applyPatch.add: cannot add "${patch.parentId}" inside itself`);
      }
      const treeIds = collectIds(root);
      for (const id of newIds) {
        if (treeIds.has(id)) {
          throw new Error(
            `applyPatch.add: node id "${id}" already exists in the document (ids must be unique)`,
          );
        }
      }
      if (patch.index === undefined || patch.index >= parent.children.length) {
        parent.children.push(node);
      } else {
        parent.children.splice(patch.index, 0, node);
      }
      break;
    }
    case "remove": {
      const holder = findParent(root, patch.targetId);
      if (!holder) throw new Error(`applyPatch.remove: "${patch.targetId}" not found`);
      holder.parent.children = holder.parent.children ?? [];
      holder.parent.children.splice(holder.index, 1);
      break;
    }
    case "move": {
      assertNonNegativeIndex("move", patch.index);
      const holder = findParent(root, patch.targetId);
      if (!holder) throw new Error(`applyPatch.move: "${patch.targetId}" not found`);
      const newParent = findNode(root, patch.newParentId);
      if (!newParent) throw new Error(`applyPatch.move: parent "${patch.newParentId}" not found`);
      // Moving a node into itself or one of its own descendants would detach
      // the whole subtree from the tree root (silent data loss) or create a
      // cycle — reject like Figma/Design tools do.
      if (patch.newParentId === patch.targetId) {
        throw new Error(`applyPatch.move: "${patch.targetId}" cannot be moved into itself`);
      }
      const targetNode = findNode(root, patch.targetId);
      if (targetNode) {
        let insideSubtree = false;
        forEachTree(targetNode, (n) => {
          if (n.id === patch.newParentId) insideSubtree = true;
        });
        if (insideSubtree) {
          throw new Error(
            `applyPatch.move: "${patch.newParentId}" is inside the subtree of "${patch.targetId}"`,
          );
        }
      }
      const [moved] = holder.parent.children?.splice(holder.index, 1) ?? [];
      if (!moved) throw new Error(`applyPatch.move: "${patch.targetId}" missing after detach`);
      newParent.children = newParent.children ?? [];
      // `index` is a position in the list AFTER the node has been detached —
      // the convention LayersPanel's reorder (holder.index + delta) computes
      // against, and correct for adjacent swaps in both directions.
      if (patch.index === undefined || patch.index >= newParent.children.length) {
        newParent.children.push(moved);
      } else {
        newParent.children.splice(patch.index, 0, moved);
      }
      break;
    }
    case "update": {
      let matched = false;
      forEachTree(root, (node) => {
        if (node.id !== patch.targetId) return;
        matched = true;
        // changes use dot-path keys like "props.width" or "styles.padding" —
        // resolved against the NODE object itself (see assertSafeChangeKey).
        resolveChanges(node as unknown as Record<string, unknown>, patch.changes);
      });
      if (!matched) {
        throw new Error(`applyPatch.update: "${patch.targetId}" not found`);
      }
      break;
    }
    case "style": {
      let matched = false;
      forEachTree(root, (node) => {
        if (node.id !== patch.targetId) return;
        matched = true;
        node.styles = { ...(node.styles ?? {}), ...patch.styles };
      });
      if (!matched) {
        throw new Error(`applyPatch.style: "${patch.targetId}" not found`);
      }
      break;
    }
    case "replace": {
      const holder = findParent(root, patch.targetId);
      if (!holder) throw new Error(`applyPatch.replace: "${patch.targetId}" not found`);
      holder.parent.children ??= [];
      const node = deepClone(patch.node);
      // The replacement subtree must not reuse ids that exist OUTSIDE the
      // node being replaced — otherwise findNode/update would hit two nodes.
      const oldIds = collectIds(holder.parent.children[holder.index] ?? node);
      const newIds = collectIds(node);
      const treeIds = collectIds(root);
      for (const id of newIds) {
        if (treeIds.has(id) && !oldIds.has(id)) {
          throw new Error(
            `applyPatch.replace: node id "${id}" already exists elsewhere in the document`,
          );
        }
      }
      holder.parent.children[holder.index] = node;
      break;
    }
  }
}

function findParent(
  root: UiNode,
  id: string,
  seen: Set<UiNode> = new Set(),
): { parent: UiNode; index: number } | null {
  if (seen.has(root)) return null;
  seen.add(root);
  const list = root.children ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === id) return { parent: root, index: i };
    const found = findParent(list[i], id, seen);
    if (found) return found;
  }
  return null;
}

/** All ids in a subtree. Iterative — safe on tall trees. */
function collectIds(root: UiNode): Set<string> {
  const out = new Set<string>();
  const stack: UiNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as UiNode;
    out.add(node.id);
    for (const child of node.children ?? []) stack.push(child);
  }
  return out;
}

/**
 * Apply a patch batch to an immutable document. Returns a NEW document object.
 * Throws on invalid references or unknown op — callers validate first via the
 * validators package and try/catch around AI-applied patches (plan/09 AI
 * reliability → rollback).
 */
export function applyPatchBatch(doc: UiDocument, patches: UiPatch[]): UiDocument {
  const next = deepClone(doc);
  for (const patch of patches) {
    applyOnePatch(next, patch);
  }
  return next;
}

// Code export (HTML / React / Vue) — reuses the resolved element tree above.
export * from "./export-code";
// Design-to-code bundle (components + CSS classes + design tokens, plan/07 4.2).
export * from "./design-to-code";
