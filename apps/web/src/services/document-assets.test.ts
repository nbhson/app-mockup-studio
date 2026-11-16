import { describe, expect, it } from "vitest";
import type { UiNode } from "@ai-mockup-studio/ui-schema";
import { collectImageSources } from "./document-assets";

describe("collectImageSources", () => {
  it("collects unique same-origin API images recursively", () => {
    const root: UiNode = {
      id: "root",
      type: "layout.container",
      children: [
        {
          id: "hero",
          type: "basic.image",
          props: { src: "/api/projects/p1/assets/a1/raw" },
        },
        {
          id: "nested",
          type: "layout.container",
          children: [
            {
              id: "duplicate",
              type: "basic.image",
              props: { src: "/api/projects/p1/assets/a1/raw" },
            },
            {
              id: "external",
              type: "basic.image",
              props: { src: "https://example.com/photo.png" },
            },
            {
              id: "missing",
              type: "basic.image",
              props: {},
            },
          ],
        },
      ],
    };

    expect(collectImageSources(root)).toEqual(["/api/projects/p1/assets/a1/raw"]);
  });

  it("returns an empty list when there are no project images", () => {
    const root: UiNode = {
      id: "root",
      type: "layout.container",
      children: [{ id: "text", type: "basic.text", props: { text: "Hi" } }],
    };
    expect(collectImageSources(root)).toEqual([]);
  });
});
