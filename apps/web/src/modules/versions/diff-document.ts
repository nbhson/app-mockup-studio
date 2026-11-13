import type { UiDocument, UiNode, UiStyles } from "@ai-mockup-studio/ui-schema";

// ---------------------------------------------------------------------------
// Document diff (P2.10) — used by the version history dialog to compare a
// server snapshot with the document currently open in the editor.
//
// The comparison is deliberately shallow (node identity, type/name/props and
// styles) which is enough to show "what changed" without rendering a full
// visual diff.
// ---------------------------------------------------------------------------

export interface DocumentNodeSnapshot {
  id: string;
  type: string;
  name: string;
  props: Record<string, unknown>;
  styles: UiStyles;
  depth: number;
}

export interface ChangedNode {
  id: string;
  type: string;
  name: string;
  fields: string[];
}

export interface DocumentDiff {
  added: DocumentNodeSnapshot[];
  removed: DocumentNodeSnapshot[];
  changed: ChangedNode[];
  themeChanged: boolean;
  hasChanges: boolean;
}

/** Key-order-independent serialization so JSONB round-trips do not show as changes. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function displayName(node: UiNode): string {
  return (
    node.name ||
    (node.props?.title as string) ||
    (node.props?.label as string) ||
    node.type
  );
}

/** Flatten a document into id → snapshot (pre-order, original child order). */
export function flattenDocument(
  document: UiDocument,
): Map<string, DocumentNodeSnapshot> {
  const map = new Map<string, DocumentNodeSnapshot>();
  const walk = (node: UiNode, depth: number) => {
    map.set(node.id, {
      id: node.id,
      type: node.type,
      name: displayName(node),
      props: node.props ?? {},
      styles: node.styles ?? {},
      depth,
    });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(document.root, 0);
  return map;
}

export function diffDocuments(
  before: UiDocument,
  after: UiDocument,
): DocumentDiff {
  const previous = flattenDocument(before);
  const current = flattenDocument(after);

  const added: DocumentNodeSnapshot[] = [];
  const removed: DocumentNodeSnapshot[] = [];
  const changed: ChangedNode[] = [];

  for (const [id, node] of current) {
    if (!previous.has(id)) added.push(node);
  }
  for (const [id, node] of previous) {
    if (!current.has(id)) removed.push(node);
  }
  for (const [id, node] of current) {
    const old = previous.get(id);
    if (!old) continue;
    const fields: string[] = [];
    if (old.type !== node.type) fields.push("type");
    if (old.name !== node.name) fields.push("name");
    if (stableStringify(old.props) !== stableStringify(node.props)) {
      fields.push("props");
    }
    if (stableStringify(old.styles) !== stableStringify(node.styles)) {
      fields.push("styles");
    }
    if (fields.length > 0) {
      changed.push({ id, type: node.type, name: node.name, fields });
    }
  }

  const themeChanged =
    stableStringify(before.theme) !== stableStringify(after.theme);

  return {
    added,
    removed,
    changed,
    themeChanged,
    hasChanges:
      added.length > 0 || removed.length > 0 || changed.length > 0 || themeChanged,
  };
}
