// Plugin ecosystem (plan/07 4.10): sandbox runtime + built-in catalog.
export { runPlugin, PluginSandboxError, canWrite } from "./sandbox";
export type {
  PluginSandboxOptions,
  PluginSandboxResult,
} from "./sandbox";
export { PLUGIN_CATALOG, findPlugin } from "./registry";
export type { PluginManifest, PluginPermission } from "@ai-mockup-studio/shared-types";
