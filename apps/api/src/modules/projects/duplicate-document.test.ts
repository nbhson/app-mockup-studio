import { describe, expect, it } from "vitest";
import type { UiDocument } from "@ai-mockup-studio/ui-schema";
import { remapAssetUrls } from "./duplicate-document";

function makeDocument(): UiDocument {
  return {
    schemaVersion: "0.1.0",
    id: "doc",
    pageId: "page",
    name: "Assets",
    viewport: { width: 1440, height: 900 },
    theme: {
      mode: "light",
      primary: "#2563EB",
      primaryForeground: "#ffffff",
      background: "#ffffff",
      foreground: "#0F172A",
      muted: "#F1F5F9",
      mutedForeground: "#64748B",
      border: "#E2E8F0",
      fontFamily: "Inter, sans-serif",
      radius: 8,
    },
    root: {
      id: "root",
      type: "layout.container",
      children: [
        {
          id: "card",
          type: "formal.card",
          children: [
            {
              id: "hero",
              type: "basic.image",
              props: { src: "/api/projects/p1/assets/a1/raw", alt: "hero" },
            },
          ],
        },
        {
          id: "logo",
          type: "basic.image",
          props: { src: "https://example.com/logo.png", alt: "logo" },
        },
      ],
    },
  };
}

describe("remapAssetUrls", () => {
  it("rewrites nested asset URLs while preserving other props and URLs", () => {
    const doc = makeDocument();
    const copy = remapAssetUrls(
      doc,
      new Map([
        ["/api/projects/p1/assets/a1/raw", "/api/projects/p2/assets/a2/raw"],
      ]),
    );

    const card = copy.root.children?.[0];
    const hero = card?.children?.[0];
    const logo = copy.root.children?.[1];

    expect(hero?.props).toEqual({
      src: "/api/projects/p2/assets/a2/raw",
      alt: "hero",
    });
    expect(logo?.props?.src).toBe("https://example.com/logo.png");
    // The original document is not mutated.
    expect(doc.root.children?.[0]?.children?.[0]?.props?.src).toBe(
      "/api/projects/p1/assets/a1/raw",
    );
  });

  it("returns the same document when there are no assets", () => {
    const doc = makeDocument();
    expect(remapAssetUrls(doc, new Map())).toBe(doc);
  });
});
