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

  // --- Deep-check remediation (2026-11-19) --------------------------------

  it("blocks realm-bridge escapes from injected api functions (host Function)", () => {
    const evil: PluginManifest = {
      id: "realm",
      name: "Realm",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) {
        const viaLog = api.app.log.constructor("return typeof process")();
        const viaDoc = api.document.read().constructor.constructor("return typeof require")();
        const viaProto = Object.getPrototypeOf(api.document.read).constructor("return typeof process")();
        return { viaLog, viaDoc, viaProto };
      }`,
    };
    const result = runPlugin({ plugin: evil, document: DOC });
    // Every constructor climb must land on the CONTEXT's harmless realm.
    expect(result.returnValue).toEqual({ viaLog: "undefined", viaDoc: "undefined", viaProto: "undefined" });
  });

  it("cannot reach host functions through the invocation frame (strict-mode bootstrap)", () => {
    const evil: PluginManifest = {
      id: "frame",
      name: "Frame",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) {
        try { return { leaked: api.document.read.caller !== null }; } catch (_e) { return { leaked: false }; }
      }`,
    };
    expect(runPlugin({ plugin: evil, document: DOC }).returnValue).toEqual({ leaked: false });
  });

  it("applies the timeout to the compile/evaluate step of an IIFE main (no double side-effects, no host hang)", () => {
    const iife: PluginManifest = {
      id: "iife",
      name: "IIFE",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `(function(){ while(true) {} })()`,
    };
    const started = Date.now();
    const result = runPlugin({ plugin: iife, document: DOC, timeoutMs: 80 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("enforces maxDocumentBytes exactly (TOCTOU via per-call getters no longer works)", () => {
    const bloat: PluginManifest = {
      id: "bloat",
      name: "Bloat",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read", "write"],
      main: `function main(api) {
        let first = true;
        api.document.update({ get big() { const v = first ? "x" : "y".repeat(10 * 1024 * 1024); first = false; return v; } });
        return 1;
      }`,
    };
    const result = runPlugin({ plugin: bloat, document: DOC, maxDocumentBytes: 1024 });
    // Whatever got stored is exactly what got measured — no second serialization.
    expect(JSON.stringify(result.updatedDocument).length).toBeLessThanOrEqual(1024);
    const oversized: PluginManifest = {
      ...bloat,
      id: "oversized",
      main: `function main(api) { api.document.update({ big: "y".repeat(10 * 1024 * 1024) }); return 1; }`,
    };
    expect(() =>
      runPlugin({ plugin: oversized, document: DOC, maxDocumentBytes: 1024 }),
    ).toThrow(/vượt giới hạn/);
  });

  it("caps log output", () => {
    const chatty: PluginManifest = {
      id: "chatty",
      name: "Chatty",
      version: "1.0.0",
      apiVersion: 1,
      permissions: ["read"],
      main: `function main(api) { for (let i = 0; i < 10000; i++) api.app.log("x".repeat(1000)); return 1; }`,
    };
    const result = runPlugin({ plugin: chatty, document: DOC, timeoutMs: 1000 });
    expect(result.logs.length).toBeLessThanOrEqual(1000);
    expect(result.logs.join("").length).toBeLessThanOrEqual(400_000);
  });

  it("exposes every built-in plugin and resolves them by id", () => {
    expect(PLUGIN_CATALOG.length).toBeGreaterThanOrEqual(3);
    expect(findPlugin("doc-analyzer")).toBeDefined();
    expect(findPlugin("missing")).toBeUndefined();
  });
});
