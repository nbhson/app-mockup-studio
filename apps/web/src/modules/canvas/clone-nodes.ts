import { createId, type UiNode } from "@ai-mockup-studio/ui-schema";

/**
 * Deep-clone schema subtrees with fresh ids so pasted/duplicated nodes never
 * collide with the originals. The clone is FULLY independent: nested `props`
 * objects/arrays, `styles` and per-breakpoint `responsive` overrides are all
 * copied, so later edits to the source node can never mutate the copy (and
 * vice versa).
 */
export function cloneWithNewIds(nodes: UiNode[]): UiNode[] {
  return nodes.map((node) => {
    // UiNode is plain JSON data, so a JSON round-trip copies every nested
    // level — a top-level spread used to share props objects/arrays and
    // left `responsive` as the same reference entirely. JSON (rather than
    // structuredClone) also survives Vue reactive proxies, which callers
    // like the canvas clipboard pass straight out of the Pinia store.
    const copy = JSON.parse(JSON.stringify(node)) as UiNode;
    const visit = (n: UiNode): void => {
      n.id = createId(n.type.replace(/^[a-z]+\./, ""));
      // A pasted copy should be editable even if the source layer was hidden
      // or locked, otherwise the new node appears missing or cannot be
      // modified — at every depth, like before.
      n.hidden = undefined;
      n.locked = undefined;
      n.children?.forEach(visit);
    };
    visit(copy);
    return copy;
  });
}
