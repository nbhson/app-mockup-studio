// ---------------------------------------------------------------------------
// Component Registry — the list of components the studio knows how to render.
// (plan/08: this is source-level registry inside `ui-schema`; DB only stores
//  the component `type` + `id` + `props` inside the JSON document.)
// ---------------------------------------------------------------------------

import type { ComponentDefinition } from "./schema";

/** A simple, deterministic id generator (crypto-free, safe for the UI). */
export function createId(prefix = "node"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export const componentRegistry: Record<string, ComponentDefinition> = {
  // --- layout ------------------------------------------------------------
  "layout.sidebar": {
    type: "layout.sidebar",
    category: "layout",
    label: "Sidebar",
    isContainer: true,
    allowedChildren: ["layout", "basic", "formal", "dashboard"],
    defaultProps: { width: 260, collapsible: true, title: "Sidebar" },
    defaultStyles: {
      width: 260,
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      backgroundColor: "#f8fafc",
      borderColor: "#e2e8f0",
    },
  },
  "layout.navbar": {
    type: "layout.navbar",
    category: "layout",
    label: "Navbar",
    isContainer: true,
    allowedChildren: ["basic", "formal"],
    defaultProps: { title: "Navbar", showBack: false },
    defaultStyles: {
      height: 56,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: "#ffffff",
    },
  },
  "layout.container": {
    type: "layout.container",
    category: "layout",
    label: "Container",
    isContainer: true,
    allowedChildren: ["layout", "dashboard", "basic", "formal"],
    defaultProps: { padding: 16 },
    defaultStyles: { display: "flex", flexDirection: "column", padding: 16 },
  },
  "layout.section": {
    type: "layout.section",
    category: "layout",
    label: "Section",
    isContainer: true,
    allowedChildren: ["layout", "dashboard", "basic", "formal"],
    defaultProps: { title: undefined as unknown as string },
    defaultStyles: {
      display: "flex",
      flexDirection: "column",
      padding: 12,
      borderRadius: 8,
    },
  },
  "layout.grid": {
    type: "layout.grid",
    category: "layout",
    label: "Grid",
    isContainer: true,
    allowedChildren: ["layout", "dashboard", "basic", "formal"],
    defaultProps: { columns: 2, gap: 12 },
    defaultStyles: { display: "flex", flexWrap: "wrap", gap: 12 },
  },
  // --- dashboard ---------------------------------------------------------
  "dashboard.header": {
    type: "dashboard.header",
    category: "dashboard",
    label: "Dashboard Header",
    isContainer: false,
    defaultProps: { title: "Overview", subtitle: "Today's metrics" },
    defaultStyles: { fontSize: 24, fontWeight: 700 },
  },
  "dashboard.stats": {
    type: "dashboard.stats",
    category: "dashboard",
    label: "Stats",
    isContainer: false,
    defaultProps: { items: ["Revenue", "Customers"] },
    defaultStyles: { flex: 1, minWidth: 140, gap: 12 },
  },
  "dashboard.chart": {
    type: "dashboard.chart",
    category: "dashboard",
    label: "Chart",
    isContainer: false,
    defaultProps: { title: "Revenue", kind: "bar" },
    defaultStyles: { height: 240 },
  },
  "dashboard.table": {
    type: "dashboard.table",
    category: "dashboard",
    label: "Table",
    isContainer: false,
    defaultProps: { headers: ["Name", "Value"], rows: [["—", "—"]] },
  },
  // --- basic -------------------------------------------------------------
  "basic.button": {
    type: "basic.button",
    category: "basic",
    label: "Button",
    isContainer: false,
    defaultProps: { label: "Button", variant: "primary", disabled: false },
    defaultStyles: { padding: "8px 16px", borderRadius: 6 },
  },
  "basic.input": {
    type: "basic.input",
    category: "basic",
    label: "Input",
    isContainer: false,
    defaultProps: { placeholder: "Type here…", type: "text", label: "Input" },
    defaultStyles: { height: 36, borderRadius: 6 },
  },
  "basic.text": {
    type: "basic.text",
    category: "basic",
    label: "Text",
    isContainer: false,
    defaultProps: { text: "Text content", variant: "body" },
  },
  "basic.image": {
    type: "basic.image",
    category: "basic",
    label: "Image",
    isContainer: false,
    defaultProps: { src: "https://placehold.co/320x160", alt: "image", ratio: "16/9" },
    defaultStyles: { borderRadius: 8 },
  },
  // --- formal ------------------------------------------------------------
  "formal.card": {
    type: "formal.card",
    category: "formal",
    label: "Card",
    isContainer: true,
    allowedChildren: ["dashboard", "basic", "formal"],
    defaultProps: { title: "Card", elevation: 1 },
    defaultStyles: {
      display: "flex",
      flexDirection: "column",
      padding: 16,
      borderRadius: 8,
      backgroundColor: "#ffffff",
    },
  },
  "formal.form": {
    type: "formal.form",
    category: "formal",
    label: "Form",
    isContainer: true,
    allowedChildren: ["basic", "formal"],
    defaultProps: { title: "Form" },
    defaultStyles: { display: "flex", flexDirection: "column", gap: 12 },
  },
};

/** List of component types currently registered, for quick "is this known?" checks. */
export const knownComponentTypes: string[] = Object.keys(componentRegistry);

export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return componentRegistry[type];
}

export function isKnownComponentType(type: string): boolean {
  return type in componentRegistry;
}
