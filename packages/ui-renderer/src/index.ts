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

/** Resolve a UiNode using the component registry + theme + tokens. */
export function resolveNode(
  node: UiNode,
  theme: Theme = defaultTheme(),
  tokens: DesignTokens = defaultTokens,
): ResolvedElement {
  const def = getComponentDefinition(node.type);
  const styles: Record<string, unknown> = { ...(def?.defaultStyles ?? {}), ...(node.styles ?? {}) };
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
  const explicitRadius = node.styles?.borderRadius;
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
    children: node.children?.map((c) => resolveNode(c, theme, tokens)),
  };
}

export function resolveDocument(doc: UiDocument): ResolvedElement {
  return resolveNode(doc.root, doc.theme, defaultTokens);
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

function resolveChanges(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(changes)) {
    const parts = key.split(".");
    let cursor: Record<string, unknown> = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (typeof cursor[part] !== "object" || cursor[part] === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }
}

function findNode(root: UiNode, id: string): UiNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function forEachTree(root: UiNode, visit: (node: UiNode) => void): void {
  visit(root);
  for (const child of root.children ?? []) forEachTree(child, visit);
}

function applyOnePatch(doc: UiDocument, patch: UiPatch): void {
  const root = doc.root;
  switch (patch.op) {
    case "add": {
      const parent = findNode(root, patch.parentId);
      if (!parent) throw new Error(`applyPatch.add: parent "${patch.parentId}" not found`);
      parent.children = parent.children ?? [];
      const node = deepClone(patch.node);
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
      const holder = findParent(root, patch.targetId);
      if (!holder) throw new Error(`applyPatch.move: "${patch.targetId}" not found`);
      const newParent = findNode(root, patch.newParentId);
      if (!newParent) throw new Error(`applyPatch.move: parent "${patch.newParentId}" not found`);
      const [moved] = holder.parent.children?.splice(holder.index, 1) ?? [];
      if (!moved) throw new Error(`applyPatch.move: "${patch.targetId}" missing after detach`);
      newParent.children = newParent.children ?? [];
      if (patch.index === undefined || patch.index >= newParent.children.length) {
        newParent.children.push(moved);
      } else {
        newParent.children.splice(patch.index, 0, moved);
      }
      break;
    }
    case "update": {
      forEachTree(root, (node) => {
        if (node.id !== patch.targetId) return;
        // changes use dot-path keys like "props.width" or "styles.padding" —
        // resolved against the NODE object itself.
        resolveChanges(node as unknown as Record<string, unknown>, patch.changes);
      });
      break;
    }
    case "style": {
      forEachTree(root, (node) => {
        if (node.id !== patch.targetId) return;
        node.styles = { ...(node.styles ?? {}), ...patch.styles };
      });
      break;
    }
    case "replace": {
      const holder = findParent(root, patch.targetId);
      if (!holder) throw new Error(`applyPatch.replace: "${patch.targetId}" not found`);
      holder.parent.children ??= [];
      holder.parent.children[holder.index] = deepClone(patch.node);
      break;
    }
  }
}

function findParent(
  root: UiNode,
  id: string,
): { parent: UiNode; index: number } | null {
  const list = root.children ?? [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === id) return { parent: root, index: i };
    const found = findParent(list[i], id);
    if (found) return found;
  }
  return null;
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
