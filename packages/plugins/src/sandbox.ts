// Sandboxed plugin runtime (plan/07 4.10).
//
// A plugin's `main` runs inside a fresh `node:vm` context that is *not* given
// access to Node's globals (`process`, `require`, `Buffer`, `fetch`, timers).
// It can only reach the host through the narrow `api` object we inject:
//   api.document.read()   -> deep clone of the document (read-only view)
//   api.document.update() -> replace the document (requires "write" permission)
//   api.app.log(...)      -> structured logging surfaced to the API caller
//   api.selection         -> request context passed by the host
//
// Because the plugin gets a deep clone and can only write back via a guarded
// `update`, a crashing or malicious plugin can never corrupt the real document.
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

/** Simple deep clone that drops functions/undefined (keeps JSON-safe data). */
function clone(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeForLog(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

export class PluginSandboxError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PluginSandboxError";
  }
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
  const state: { updated: unknown; written: boolean } = {
    updated: undefined,
    written: false,
  };

  const sandboxApi = {
    document: {
      read: () => clone(document),
      update: (next: unknown): void => {
        if (!canWrite) {
          throw new PluginSandboxError(
            `Plugin "${plugin.id}" không có quyền write — chỉ đọc.`,
          );
        }
        if (next === null || typeof next !== "object" || Array.isArray(next)) {
          throw new PluginSandboxError(
            "api.document.update cần một object document hợp lệ.",
          );
        }
        const bytes = Buffer.byteLength(JSON.stringify(next));
        if (bytes > maxBytes) {
          throw new PluginSandboxError(
            `Document do plugin sinh vượt giới hạn ${maxBytes} bytes.`,
          );
        }
        state.updated = clone(next);
        state.written = true;
      },
    },
    app: {
      log: (...args: unknown[]) => {
        logs.push(args.map(sanitizeForLog).join(" "));
      },
    },
    selection: clone(selection),
  };

  const sandbox: Record<string, unknown> = { api: sandboxApi, console: sandboxApi.app };

  const context = vm.createContext(sandbox);

  // Ensure the manifest's main compiles and is a function before executing.
  try {
    const t = vm.runInContext(`typeof (${plugin.main})`, context);
    if (t !== "function") {
      throw new PluginSandboxError(
        `Plugin "${plugin.id}" phải export một function main(api).`,
      );
    }
  } catch (error) {
    if (error instanceof PluginSandboxError) throw error;
    throw new PluginSandboxError(
      `Không biên dịch được plugin "${plugin.id}": ${String(error)}`,
    );
  }

  let timedOut = false;
  let returnValue: unknown;
  try {
    // Invoke main *inside* the guarded VM context so the timeout also covers a
    // runaway synchronous loop, not just the definition.
    returnValue = vm.runInContext(
      `(${plugin.main}).call(null, api)`,
      context,
      { timeout: timeoutMs },
    );
  } catch (error) {
    const isTimeout =
      /(timed out|execution timed out)/i.test(
        String((error as { message?: unknown })?.message ?? error),
      ) ||
      (error as { code?: string })?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
    if (isTimeout) {
      timedOut = true;
    } else {
      throw new PluginSandboxError(
        `Plugin "${plugin.id}" lỗi khi chạy: ${String(error)}`,
        error as Error,
      );
    }
  }

  // A returned Promise is awaited by the caller across the boundary; we simply
  // surface it as-is (the host stores it as a JSON-safe value or null).
  if (returnValue instanceof Promise) {
    returnValue = null;
  }

  return {
    returnValue: clone(returnValue),
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
