// Sandboxed plugin runtime (plan/07 4.10).
//
// A plugin's `main` runs inside a fresh `node:vm` context that is *not* given
// access to Node's globals (`process`, `require`, `Buffer`, `fetch`, timers).
// It can only reach the host through the narrow `api` object:
//   api.document.read()   -> deep clone of the document (read-only view)
//   api.document.update() -> replace the document (requires "write" permission)
//   api.app.log(...)      -> structured logging surfaced to the API caller
//   api.selection         -> request context passed by the host
//
// SECURITY NOTES (deep-check remediation, 2026-11-19):
//  - `api` and EVERY bridge wrapper are constructed *inside* the context.
//    Injecting host-realm functions directly used to let a plugin climb
//    `api.app.log.constructor` to the HOST `Function` constructor (arbitrary
//    host code execution). With context-realm closures the climb only ever
//    reaches the context's own, harmless `Function`. Host data crosses the
//    boundary exclusively as JSON strings, parsed on the receiving side.
//  - The bootstrap runs in strict mode, so `arguments.caller` cannot leak the
//    host invocation frame either.
//  - Both the compile/evaluate step and the invocation carry the timeout.
//    A manifest like `(function(){ while(true) {} })()` (an immediately
//    invoked expression) used to hang the host forever inside the untimed
//    `typeof` check — and its side effects ran TWICE. Now the expression is
//    evaluated exactly once, under the same timeout as the call.
//  - `api.document.update` serializes ONCE (inside the context) and the host
//    measures/parses that exact string — a cross-realm getter that returned
//    different values per call can no longer bypass `maxDocumentBytes`.
//  - Logs are capped in count, per-entry size, and total size.
//  - `node:vm` is not an OS-level boundary; plugins must come from the
//    vetted catalog (or trusted uploads) until an isolate/worker exists.
import vm from "node:vm";
import type {
  PluginManifest,
  PluginPermission,
} from "@ai-mockup-studio/shared-types";

export interface PluginSandboxOptions {
  plugin: PluginManifest;
  document: unknown;
  selection?: unknown;
  /** Hard wall-clock cap (ms) for synchronous execution. Default 300ms. */
  timeoutMs?: number;
  /** Absolute max serialized document bytes a plugin may write. */
  maxDocumentBytes?: number;
}

export interface PluginSandboxResult {
  returnValue: unknown;
  logs: string[];
  updatedDocument: unknown;
  timedOut: boolean;
}

const MAX_LOG_ENTRIES = 1000;
const MAX_LOG_ENTRY_CHARS = 2000;
const MAX_LOG_TOTAL_CHARS = 200_000;

export class PluginSandboxError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PluginSandboxError";
  }
}

function isExecutionTimeout(error: unknown): boolean {
  return (
    /(timed out|execution timed out)/i.test(
      String((error as { message?: unknown })?.message ?? error),
    ) || (error as { code?: string })?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT"
  );
}

/**
 * Execute a plugin against a document snapshot in an isolated VM.
 *
 * Throws `PluginSandboxError` on compile errors, runtime exceptions, write
 * attempts without permission, or writes exceeding the size cap. On success it
 * returns the plugin's return value, its logs, and — when the plugin called
 * `api.document.update` with the correct permission — the new document.
 */
export function runPlugin(options: PluginSandboxOptions): PluginSandboxResult {
  const { plugin, document, selection } = options;
  const timeoutMs = options.timeoutMs ?? 300;
  const maxBytes = options.maxDocumentBytes ?? 4 * 1024 * 1024;

  const canWrite = plugin.permissions.includes("write");
  const logs: string[] = [];
  let logChars = 0;
  const state: { updated: unknown; written: boolean } = {
    updated: undefined,
    written: false,
  };

  const documentJson = () => JSON.stringify(document ?? null);
  const selectionJson = () => JSON.stringify(selection ?? null);

  const acceptUpdate = (serialized: string): void => {
    if (!canWrite) {
      throw new PluginSandboxError(
        `Plugin "${plugin.id}" không có quyền write — chỉ đọc.`,
      );
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > maxBytes) {
      throw new PluginSandboxError(
        `Document do plugin sinh vượt giới hạn ${maxBytes} bytes.`,
      );
    }
    // The stored value is parsed from the SAME string that was measured, so
    // getter trickery cannot inflate it afterwards.
    const parsed = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PluginSandboxError(
        "api.document.update cần một object document hợp lệ.",
      );
    }
    state.updated = parsed;
    state.written = true;
  };

  const acceptLog = (line: string): void => {
    if (logs.length >= MAX_LOG_ENTRIES || logChars >= MAX_LOG_TOTAL_CHARS) return;
    const clipped =
      line.length > MAX_LOG_ENTRY_CHARS ? `${line.slice(0, MAX_LOG_ENTRY_CHARS)}…` : line;
    logs.push(clipped);
    logChars += clipped.length;
  };

  // Build the api object INSIDE the context. The host bridge functions exist
  // only as parameters of this strict-mode closure; nothing the plugin can
  // enumerate (globals, prototypes, frames) ever points at a host function.
  const vmContext = vm.createContext({});
  const bootstrap = vm.runInContext(
    `'use strict';
(function setup(hostDocumentJson, hostSelectionJson, hostUpdate, hostLog) {
  const parseJson = (s) => (s === null || s === undefined ? undefined : JSON.parse(s));
  const stringifyArg = (a) => {
    try { const s = JSON.stringify(a); return s === undefined ? String(a) : s; }
    catch (_e) { try { return String(a); } catch (_x) { return '[unstringifiable]'; } }
  };
  const api = {
    document: {
      read: function read() { return parseJson(hostDocumentJson()); },
      update: function update(next) {
        let serialized;
        try { serialized = JSON.stringify(next === undefined ? null : next); }
        catch (_e) { throw new TypeError('api.document.update cần một JSON object hợp lệ.'); }
        if (typeof serialized !== 'string') serialized = 'null';
        hostUpdate(serialized);
      },
    },
    app: { log: function log() { hostLog(Array.prototype.map.call(arguments, stringifyArg).join(' ')); } },
    selection: parseJson(hostSelectionJson()),
  };
  globalThis.api = api;
  globalThis.console = api.app;
  globalThis.__serialize = function __serialize(v) {
    try { const s = JSON.stringify(v === undefined ? null : v); return typeof s === 'string' ? s : 'null'; }
    catch (_e) { return null; }
  };
  return true;
})`,
    vmContext,
  );
  (bootstrap as unknown as (
    hostDocumentJson: () => string,
    hostSelectionJson: () => string,
    hostUpdate: (s: string) => void,
    hostLog: (line: string) => void,
  ) => boolean)(documentJson, selectionJson, acceptUpdate, acceptLog);

  // Compile + evaluate the manifest expression EXACTLY ONCE, with a timeout.
  try {
    vm.runInContext(`globalThis.__main = (${plugin.main});`, vmContext, {
      timeout: timeoutMs,
    });
  } catch (error) {
    if (isExecutionTimeout(error)) {
      return { returnValue: null, logs, updatedDocument: undefined, timedOut: true };
    }
    throw new PluginSandboxError(
      `Không biên dịch được plugin "${plugin.id}": ${String(error)}`,
    );
  }

  const mainType = vm.runInContext(`typeof globalThis.__main`, vmContext);
  if (mainType !== "function") {
    throw new PluginSandboxError(
      `Plugin "${plugin.id}" phải export một function main(api).`,
    );
  }

  let timedOut = false;
  let rawReturnJson: string | null = "null";
  try {
    // Invoke main *inside* the guarded VM context so the timeout also covers a
    // runaway synchronous loop, not just the definition.
    vm.runInContext(`globalThis.__main_result = globalThis.__main.call(null, api)`, vmContext, {
      timeout: timeoutMs,
    });
    // Serialize the result INSIDE the context (under a timeout): a returned
    // object with malicious getters can never run code on the host afterwards.
    // Promises are surfaced as null — they cannot be awaited across this
    // synchronous boundary (matching the previous contract).
    rawReturnJson = vm.runInContext(
      `globalThis.__main_result instanceof Promise ? 'null' : globalThis.__serialize(globalThis.__main_result)`,
      vmContext,
      { timeout: timeoutMs },
    ) as string | null;
  } catch (error) {
    if (error instanceof PluginSandboxError) throw error;
    if (isExecutionTimeout(error)) {
      timedOut = true;
    } else {
      throw new PluginSandboxError(
        `Plugin "${plugin.id}" lỗi khi chạy: ${String(error)}`,
        error as Error,
      );
    }
  }

  let returnValue: unknown;
  try {
    returnValue = rawReturnJson === null ? null : JSON.parse(rawReturnJson);
  } catch {
    returnValue = null;
  }

  return {
    returnValue,
    logs,
    updatedDocument: state.written ? state.updated : undefined,
    timedOut,
  };
}

/**
 * Resolve a plain check: does the manifest's permission set allow document
 * mutation? Exported for host role/permission decisions.
 */
export function canWrite(permissions: PluginPermission[]): boolean {
  return permissions.includes("write");
}
