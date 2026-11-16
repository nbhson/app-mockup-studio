// Collect project images referenced by a document and inline them as data URLs
// for code export. External URLs are left untouched (the exported file keeps
// loading them); only same-origin API assets are embedded.
import type { UiNode } from "@ai-mockup-studio/ui-schema";

export function collectImageSources(root: UiNode): string[] {
  const found = new Set<string>();
  const walk = (node: UiNode) => {
    const src = node.props?.src;
    if (typeof src === "string" && src.startsWith("/api/")) found.add(src);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return [...found];
}

export async function collectAssetMap(root: UiNode): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const sources = collectImageSources(root);
  if (sources.length === 0) return map;

  await Promise.all(
    sources.map(async (src) => {
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const blob = await res.blob();
        map[src] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        // Fall back to the absolute URL provided via baseUrl.
      }
    }),
  );
  return map;
}
