// ---------------------------------------------------------------------------
// Sample documents & the keyword-based mock generator.
//
// These power BOTH the seed step AND the built-in "mock" AI provider that the
// API uses when no OPENAI_API_KEY is configured — so the MVP is fully runnable
// end-to-end with zero external services.
// ---------------------------------------------------------------------------

import { SCHEMA_VERSION, createId, type UiDocument, type ViewportMode } from "@ai-mockup-studio/ui-schema";

export function baseTheme() {
  return {
    mode: "light" as const,
    primary: "#2563EB",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#0F172A",
    muted: "#F1F5F9",
    mutedForeground: "#64748B",
    border: "#E2E8F0",
    fontFamily: "Inter, system-ui, sans-serif",
    radius: 8,
  };
}

const VIEWPORTS: Record<ViewportMode, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

export function buildSampleDashboard(name = "CRM Dashboard Demo"): UiDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc-crm-dashboard",
    pageId: "page-crm-dashboard",
    name,
    viewport: VIEWPORTS.desktop,
    theme: baseTheme(),
    root: {
      id: "root",
      type: "layout.container",
      name: name,
      props: { padding: 0 },
      styles: { flexDirection: "row", height: 900, backgroundColor: "#F8FAFC" },
      children: [
        {
          id: "sb-main",
          type: "layout.sidebar",
          props: { width: 260, collapsible: true, title: "CRM App" },
          styles: { width: 260, padding: 16, gap: 8, flexDirection: "column", backgroundColor: "#F1F5F9" },
          children: [
            {
              id: "sb-item-1",
              type: "basic.text",
              props: { text: "Dashboard", variant: "label" },
              styles: { fontWeight: 600, color: "#2563EB" },
            },
            {
              id: "sb-item-2",
              type: "basic.text",
              props: { text: "Accounts", variant: "label" },
              styles: { color: "#64748B" },
            },
            {
              id: "sb-item-3",
              type: "basic.text",
              props: { text: "Reports", variant: "label" },
              styles: { color: "#64748B" },
            },
            {
              id: "sb-item-4",
              type: "basic.text",
              props: { text: "Settings", variant: "label" },
              styles: { color: "#64748B" },
            },
          ],
        },
        {
          id: "main-content",
          type: "layout.container",
          props: { padding: 24 },
          styles: { flexDirection: "column", gap: 16, padding: 24, flex: 1 },
          children: [
            {
              id: "hdr-overview",
              type: "dashboard.header",
              props: { title: "Sales Overview", subtitle: "Today's metrics at a glance" },
            },
            {
              id: "stats-row",
              type: "layout.grid",
              props: { columns: 4, gap: 12 },
              styles: { gap: 12 },
              children: [
                {
                  id: "stat-revenue",
                  type: "dashboard.stats",
                  props: { items: ["Revenue"], values: ["$45,230"] },
                },
                {
                  id: "stat-customers",
                  type: "dashboard.stats",
                  props: { items: ["Customers"], values: ["2,450"] },
                },
                {
                  id: "stat-orders",
                  type: "dashboard.stats",
                  props: { items: ["Orders"], values: ["1,820"] },
                },
                {
                  id: "stat-ratio",
                  type: "dashboard.stats",
                  props: { items: ["Conversion"], values: ["4.2%"] },
                },
              ],
            },
            {
              id: "section-chart",
              type: "formal.card",
              props: { title: "Revenue Trend" },
              styles: { width: "100%" },
              children: [
                {
                  id: "chart-revenue",
                  type: "dashboard.chart",
                  props: { title: "Monthly Revenue", kind: "bar" },
                  styles: { height: 220 },
                },
              ],
            },
            {
              id: "section-table",
              type: "formal.card",
              props: { title: "Recent Accounts" },
              children: [
                {
                  id: "tbl-accounts",
                  type: "dashboard.table",
                  props: {
                    headers: ["Customer", "Plan", "Status"],
                    rows: [
                      ["Acme Corp", "Enterprise", "Active"],
                      ["Globex", "Pro", "Active"],
                      ["Initech", "Starter", "Trial"],
                      ["Umbrella", "Enterprise", "Active"],
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** A minimal, safe mock generator: picks a template based on keywords. */
export function generateMockDocument(prompt: string, viewportMode: ViewportMode = "desktop"): UiDocument {
  void prompt;
  const doc = buildSampleDashboard();
  doc.id = createId("doc");
  doc.pageId = createId("page");
  doc.viewport = VIEWPORTS[viewportMode];
  doc.name = "Mockup: " + (prompt.trim().split("\n")[0] || "Untitled").slice(0, 40);
  return doc;
}
