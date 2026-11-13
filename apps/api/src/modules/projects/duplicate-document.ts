import type { UiDocument, UiNode } from "@ai-mockup-studio/ui-schema";

/**
 * Duplicating a project also duplicates its assets, which get new ids and
 * therefore new raw URLs. Rewrite `props.src` references in the copied schema
 * so images keep working in the duplicate instead of pointing at the source
 * project (where the asset route is project-scoped).
 */
export function remapAssetUrls(
  document: UiDocument,
  urlMap: ReadonlyMap<string, string>,
): UiDocument {
  if (urlMap.size === 0) return document;

  const remapNode = (node: UiNode): UiNode => {
    const src = node.props?.src;
    const nextSrc = typeof src === "string" ? urlMap.get(src) : undefined;
    return {
      ...node,
      props: nextSrc ? { ...node.props, src: nextSrc } : node.props,
      children: node.children?.map(remapNode),
    };
  };

  return { ...document, root: remapNode(document.root) };
}
