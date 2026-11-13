import { createId, type UiNode } from "@ai-mockup-studio/ui-schema";

/**
 * Deep-clone schema subtrees with fresh ids so pasted/duplicated nodes never
 * collide with the originals. Props/styles are copied so the clone is fully
 * independent from later edits to the source node.
 */
export function cloneWithNewIds(nodes: UiNode[]): UiNode[] {
  const clone = (node: UiNode): UiNode => ({
    ...node,
    id: createId(node.type.replace(/^[a-z]+\./, "")),
    // A pasted copy should be editable even if the source layer was hidden or
    // locked, otherwise the new node appears missing or cannot be modified.
    hidden: undefined,
    locked: undefined,
    props: node.props ? { ...node.props } : undefined,
    styles: node.styles ? { ...node.styles } : undefined,
    children: node.children ? node.children.map(clone) : undefined,
  });
  return nodes.map(clone);
}
