import { describe, expect, it } from "vitest";
import { PLUGIN_CATALOG, findPlugin } from "./registry";
import { PluginSandboxError, runPlugin } from "./sandbox";
import type { PluginManifest } from "@ai-mockup-studio/shared-types";

const DOC = {
  schemaVersion: "0.1.0",
  id: "d1",
  pageId: "p1",
  name: "Sample",
  viewport: { width: 1440, height: 900 },
  theme: { mode: "light" },
  root: {
    id: "root",
    type: "layout.container",
    children: [
      { id: "t1", type: "typography.text", text: "hello world" },
      { id: "t2", type: "typography.text", text: "second line" },
      { id: "empty", type: "layout.container", children: [] },
    ],
  },
};

describe("plugin sandbox", () => {
  it("runs a read-only plugin and returns its stats without mutating the doc", () => {
    const analyzer = findPlugin("doc-analyzer");
    expect(analyzer).toBeDefined();
    const result = runPlugin({ plugin: analyzer!, document: DOC });
    expect(result.timedOut).toBe(false);
    const stats = result.returnValue as { nodes: number; textNodes: number; chars: number };
    expect(stats.textNodes).toBe(2);
    expect(stats.chars).toBe(22); // "hello world" (11) + "second line" (11)
    // The plugin only observed; the document is untouched.
    expect((DOC.root.children[0] as { text: string }).text).toBe("hello world");
  });

  it("lets a write plugin transform the document through api.document.update", () => {
    const upper = findPlugin("text-uppercase");
    expect(upper).toBeDefined();
    const result = runPlugin({ plugin: upper!, document: DOC });
    expect(result.timedOut).toBe(false);
    const updated = result.updatedDocument as typeof DOC;
    expect((updated.root.children[0] as { text: string }).text).toBe("HELLO WORLD");
    expect((updated.root.children[1] as { text: string }).text).toBe("SECOND LINE");
    // The original snapshot is not mutated by the write.
    expect((DOC.root.children[0] as { text: string }).text).toBe("hello world");
  });

  it("refuses a write from a read-only plugin", () => {
    const readOnly: PluginManifest = {
      id: "rogue",
      name: "Rogue",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) {
        api.document.update({});
      }`,
    };
    expect(() => runPlugin({ plugin: readOnly, document: DOC })).toThrow(
      PluginSandboxError,
    );
  });

  it("keeps Node globals out of the sandbox", () => {
    const spy: PluginManifest = {
      id: "spy",
      name: "Spy",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) {
        let leaked = false;
        try { if (typeof process !== "undefined") leaked = true; } catch (e) {}
        try { if (typeof require !== "undefined") leaked = true; } catch (e) {}
        return { leaked: leaked };
      }`,
    };
    const result = runPlugin({ plugin: spy, document: DOC });
    expect((result.returnValue as { leaked: boolean }).leaked).toBe(false);
  });

  it("caps runaway plugins with a timeout", () => {
    const runaway: PluginManifest = {
      id: "runaway",
      name: "Runaway",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) { while (true) { var x = 1; } }`,
    };
    const result = runPlugin({ plugin: runaway, document: DOC, timeoutMs: 50 });
    expect(result.timedOut).toBe(true);
    expect(result.updatedDocument).toBeUndefined();
  });

  it("rejects a manifest whose main is not a function", () => {
    const bad: PluginManifest = {
      id: "bad",
      name: "Bad",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `42`,
    };
    expect(() => runPlugin({ plugin: bad, document: DOC })).toThrow(
      /function main/,
    );
  });

  it("rejects a non-object document write", () => {
    const w: PluginManifest = {
      id: "w",
      name: "W",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read", "write"],
      main: `function main(api) { api.document.update("nope"); return 1; }`,
    };
    expect(() => runPlugin({ plugin: w, document: DOC })).toThrow(
      /object document/,
    );
  });

  it("exposes every built-in plugin and resolves them by id", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThanOrEqual(3);
    expect(findPlugin("doc-analyzer")).toBeDefined();
    expect(findPlugin("missing")).toBeUndefined();
  });
});
