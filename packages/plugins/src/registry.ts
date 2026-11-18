// Built-in plugin catalog (plan/07 4.10 "marketplace tối giản"). Each entry is
// a static manifest whose `main` is a JS function expression that runs in the
// sandbox. The catalog is the source of truth for `GET /plugins` and defines
// which plugins can be run against a project's document.
//
// NOTE: the `main` strings avoid template-literal `${...}` so they can be
// embedded in TypeScript template literals without interpolation. Use plain
// string concatenation inside plugin code.
import type { PluginManifest } from "@ai-mockup-studio/shared-types";

/**
 * Read-only analyzer: counts nodes and text, reports a small summary. Safe on
 * any document shape — used to prove read-only plugins only observe.
 */
const ANALYZER: PluginManifest = {
  id: "doc-analyzer",
  name: "Document Analyzer",
  version: "1.0.0",
  description:
    "Đọc document và trả về thống kê: tổng số node, số node text, tổng ký tự.",
  author: "AI Mockup Studio",
  apiVersion: 1,
  permissions: ["read"],
  main: `function main(api) {
    const doc = api.document.read();
    let nodes = 0;
    let textNodes = 0;
    let chars = 0;
    function textOf(node) {
      if (typeof node.text === "string" && node.text.length > 0) return node.text;
      if (node.props && typeof node.props.text === "string" && node.props.text.length > 0) {
        return node.props.text;
      }
      return "";
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      nodes += 1;
      var t = textOf(node);
      if (t.length > 0) {
        textNodes += 1;
        chars += t.length;
      }
      const children = node.children;
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) walk(children[i]);
      }
    }
    walk(doc && doc.root);
    api.app.log("analyzed document");
    return { plugin: "doc-analyzer", nodes: nodes, textNodes: textNodes, chars: chars };
  }`,
};

/**
 * Write plugin: upper-cases the text of every text node. Demonstrates a safe,
 * targeted mutation through api.document.update.
 */
const UPPERCASE: PluginManifest = {
  id: "text-uppercase",
  name: "Uppercase Text",
  version: "1.0.0",
  description: "Chuyển toàn bộ chữ trong mọi nút text thành IN HOA.",
  author: "AI Mockup Studio",
  apiVersion: 1,
  permissions: ["read", "write"],
  main: `function main(api) {
    const doc = api.document.read();
    if (!doc || !doc.root) {
      api.app.log("no document to transform");
      return { changed: 0 };
    }
    let changed = 0;
    function textOf(node) {
      if (typeof node.text === "string") return node.text;
      if (node.props && typeof node.props.text === "string") return node.props.text;
      return null;
    }
    function setText(node, newText) {
      if (typeof node.text === "string") { node.text = newText; changed += 1; return; }
      if (node.props) { node.props.text = newText; changed += 1; }
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      var t = textOf(node);
      if (t !== null && t.length > 0) setText(node, t.toUpperCase());
      const children = node.children;
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) walk(children[i]);
      }
    }
    walk(doc.root);
    api.document.update(doc);
    api.app.log("uppercased " + changed + " text nodes");
    return { changed: changed };
  }`,
};

/**
 * Read-only layout sanity check: finds elements that have no children and no
 * meaningful geometry, which are usually accidental empties.
 */
const EMPTY_CHECK: PluginManifest = {
  id: "layout-checker",
  name: "Layout Checker",
  version: "1.0.0",
  description:
    "Rà soát document, liệt kê những node container rỗng có thể là lỗi bố cục.",
  author: "AI Mockup Studio",
  apiVersion: 1,
  permissions: ["read"],
  main: `function main(api) {
    const doc = api.document.read();
    const issues = [];
    function walk(node, path) {
      if (!node || typeof node !== "object") return;
      const id = node.id ? String(node.id) : "?";
      const here = path + "/" + id;
      const children = node.children;
      const isEmptyContainer =
        Array.isArray(children) && children.length === 0 && !node.text;
      if (isEmptyContainer) {
        issues.push({ path: here, type: String(node.type || "unknown") });
      }
      if (Array.isArray(children)) {
        for (let i = 0; i < children.length; i++) walk(children[i], here);
      }
    }
    walk(doc && doc.root, "");
    api.app.log("layout check complete");
    return { issues: issues };
  }`,
};

export const PLUGIN_CATALOG: PluginManifest[] = [
  ANALYZER,
  UPPERCASE,
  EMPTY_CHECK,
];

export function findPlugin(id: string): PluginManifest | undefined {
  return PLUGIN_CATALOG.find((p) => p.id === id);
}
