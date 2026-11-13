import type { UiDocument, UiNode } from "./schema";

/**
 * Tree helpers used by the renderer, the validator, the command manager and
 * the AI patch generator. They are pure functions over the immutable tree.
 */

/** Depth-first traversal, visiting parent before children. Mutates nothing. */
export function walkTree(
  root: UiNode,
  visit: (node: UiNode, parentId: string | null, depth: number) => void,
): void {
  const rec = (node: UiNode, parentId: string | null, depth: number) => {
    visit(node, parentId, depth);
    for (const child of node.children ?? []) rec(child, node.id, depth + 1);
  };
  rec(root, null, 0);
}

/** Find a node by id. Returns undefined if not found. */
export function findNode(root: UiNode, id: string): UiNode | undefined {
  let result: UiNode | undefined;
  walkTree(root, (node) => {
    if (node.id === id) result = node;
  });
  return result;
}

/**
 * Find the parent container of a node id. Returns [parent, indexInParent].
 */
export function findParent(
  root: UiNode,
  id: string,
): { parent: UiNode; index: number } | null {
  let found: { parent: UiNode; index: number } | null = null;
  const rec = (node: UiNode, parent: UiNode | null) => {
    if (found) return;
    if (parent && node.id === id) {
      const index = (parent.children ?? []).findIndex((c) => c.id === id);
      found = { parent, index };
      return;
    }
    for (const child of node.children ?? []) rec(child, node);
  };
  rec(root, null);
  return found;
}

export function nodeDepth(root: UiNode, id: string): number | null {
  let depth: number | null = null;
  walkTree(root, (node, _parentId, d) => {
    if (node.id === id) depth = d;
  });
  return depth;
}

/** Collect all node ids in a tree (in depth-first order). */
export function collectIds(root: UiNode): string[] {
  const ids: string[] = [];
  walkTree(root, (node) => ids.push(node.id));
  return ids;
}

/**
 * Collect every node whose id is NOT in the tree — used to validate that an
 * AI patch does not reference missing ids.
 */
export function collectDistinctTypes(root: UiNode): string[] {
  const types = new Set<string>();
  walkTree(root, (node) => types.add(node.type));
  return [...types];
}

export interface DocumentStats {
  nodeCount: number;
  componentTypeCounts: Record<string, number>;
}

export function documentStats(doc: UiDocument): DocumentStats {
  const counts: Record<string, number> = {};
  let nodeCount = 0;
  walkTree(doc.root, (node) => {
    nodeCount += 1;
    counts[node.type] = (counts[node.type] ?? 0) + 1;
  });
  return { nodeCount, componentTypeCounts: counts };
}
