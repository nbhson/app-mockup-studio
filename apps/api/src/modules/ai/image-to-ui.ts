// ---------------------------------------------------------------------------
// AI image-to-UI (plan/07 3.1).
//
// The API sends the screenshot to a vision model when one is configured. When
// no model is available (or it returns invalid JSON) this module builds a
// deterministic, editable mockup from the image dimensions, aspect ratio and
// the optional user prompt. No native image dependencies are required.
// ---------------------------------------------------------------------------

import {
  SCHEMA_VERSION,
  componentRegistry,
  createId,
  type UiDocument,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import { baseTheme } from "../../sample-documents";

export interface ImageDimensions {
  width: number;
  height: number;
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

/** Parse PNG/JPEG/WebP dimensions from raw bytes (no image decoding needed). */
export function readImageSize(data: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === "image/png" && data.length >= 24) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }

  if (mimeType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = data[offset + 1];
      if (
        marker === 0xd8 ||
        marker === 0xd9 ||
        (marker >= 0xd0 && marker <= 0xd7) ||
        marker === 0x01
      ) {
        offset += 2;
        continue;
      }
      const length = data.readUInt16BE(offset + 2);
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        return {
          height: data.readUInt16BE(offset + 5),
          width: data.readUInt16BE(offset + 7),
        };
      }
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }

  if (mimeType === "image/webp" && data.length >= 30) {
    const chunk = data.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + data.readUIntLE(24, 3),
        height: 1 + data.readUIntLE(27, 3),
      };
    }
    if (chunk === "VP8 ") {
      return {
        width: data.readUInt16LE(26) & 0x3fff,
        height: data.readUInt16LE(28) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && data.length >= 25) {
      return {
        width: 1 + (((data[22] & 0x3f) << 8) | data[21]),
        height:
          1 +
          (((data[24] & 0xf) << 10) |
            (data[23] << 2) |
            ((data[22] & 0xc0) >> 6)),
      };
    }
  }

  return null;
}

export interface ImageToUiFallbackInput {
  width: number;
  height: number;
  mimeType: string;
  prompt?: string;
  viewport?: keyof typeof VIEWPORTS;
}

type Layout = "dashboard" | "landing" | "form" | "mobile";

export function heuristicImageToUi(input: ImageToUiFallbackInput): UiDocument {
  const ratio = input.height > 0 ? input.width / input.height : 1.6;
  const mode =
    input.viewport ?? (ratio >= 1.35 ? "desktop" : ratio <= 0.85 ? "mobile" : "tablet");
  const layout = inferLayout(input.prompt, mode);
  const root = buildLayout(layout, mode);
  const promptName = input.prompt?.trim().split("\n")[0]?.slice(0, 40);

  return {
    schemaVersion: SCHEMA_VERSION,
    id: createId("doc"),
    pageId: createId("page"),
    name: promptName
      ? `Mockup: ${promptName}`
      : `Mockup từ ảnh ${input.width}×${input.height}`,
    viewport: VIEWPORTS[mode],
    theme: baseTheme(),
    root,
  };
}

function inferLayout(prompt: string | undefined, mode: keyof typeof VIEWPORTS): Layout {
  const text = (prompt ?? "").toLowerCase();
  if (
    /(form|biểu mẫu|đăng ký|đăng nhập|login|sign\s?up|checkout|thanh toán|contact|liên hệ)/.test(
      text,
    )
  ) {
    return "form";
  }
  if (
    /(landing|marketing|hero|giới thiệu|pricing|sản phẩm|product|bán hàng)/.test(text)
  ) {
    return "landing";
  }
  return mode === "mobile" ? "mobile" : "dashboard";
}

function buildLayout(layout: Layout, mode: keyof typeof VIEWPORTS): UiNode {
  if (layout === "form") return buildFormLayout();
  if (layout === "landing") return buildLandingLayout();
  if (layout === "mobile") return buildMobileLayout();
  return buildDashboardLayout(mode);
}

function buildDashboardLayout(mode: keyof typeof VIEWPORTS): UiNode {
  const content = container(
    [
      header("Overview", "Recreated from your screenshot"),
      statsGrid(mode === "mobile" ? 2 : 4),
      card("Revenue trend", [chart("Monthly revenue")]),
      card("Recent activity", [
        table(
          ["Customer", "Plan", "Status"],
          [
            ["Acme Corp", "Enterprise", "Active"],
            ["Globex", "Pro", "Active"],
            ["Initech", "Starter", "Trial"],
          ],
        ),
      ]),
    ],
    { padding: 24, gap: 16, flex: 1 },
  );

  if (mode === "mobile") {
    return container([navbar("Workspace"), content], {
      flexDirection: "column",
      padding: 0,
      backgroundColor: "#F8FAFC",
    });
  }

  return container(
    [
      container(
        [
          text("Dashboard", { fontWeight: 600, color: "#2563EB" }),
          text("Projects", { color: "#64748B" }),
          text("Reports", { color: "#64748B" }),
          text("Settings", { color: "#64748B" }),
        ],
        {
          width: mode === "tablet" ? 200 : 240,
          flexDirection: "column",
          gap: 8,
          padding: 16,
          backgroundColor: "#F1F5F9",
        },
        "layout.sidebar",
        { width: mode === "tablet" ? 200 : 240, title: "Workspace" },
      ),
      content,
    ],
    {
      flexDirection: "row",
      padding: 0,
      height: VIEWPORTS[mode].height,
      backgroundColor: "#F8FAFC",
    },
  );
}

function buildLandingLayout(): UiNode {
  return container(
    [
      navbar("Acme"),
      container(
        [
          header("Build something people love", "A clean landing page from your reference"),
          container(
            [
              container(
                [
                  text(
                    "Everything you need to launch faster, in one focused workspace.",
                    { fontSize: 16, color: "#475569" },
                  ),
                  button("Get started"),
                ],
                { flexDirection: "column", gap: 16, flex: 1 },
              ),
              image("Product preview"),
            ],
            { flexDirection: "row", gap: 24, alignItems: "center" },
          ),
          container(
            [
              card("Fast", [
                text("Ship polished screens without starting from zero."),
              ]),
              card("Flexible", [
                text("Every component stays editable in the canvas."),
              ]),
              card("Consistent", [
                text("Shared tokens keep the whole page on brand."),
              ]),
            ],
            { flexDirection: "row", gap: 16 },
            "layout.grid",
            { columns: 3, gap: 16 },
          ),
        ],
        { flexDirection: "column", gap: 24, padding: 32 },
      ),
    ],
    { flexDirection: "column", padding: 0, backgroundColor: "#FFFFFF" },
  );
}

function buildFormLayout(): UiNode {
  return container(
    [
      navbar("Acme"),
      container(
        [
          header("Create your account", "Start your free trial in under a minute"),
          container(
            [
              input("Email", "you@example.com"),
              input("Password", "••••••••"),
              button("Create account"),
            ],
            { flexDirection: "column", gap: 12 },
            "formal.form",
            { title: "Sign up" },
          ),
        ],
        { flexDirection: "column", gap: 20, padding: 32, maxWidth: 520, alignSelf: "center" },
      ),
    ],
    { flexDirection: "column", padding: 0, backgroundColor: "#F8FAFC" },
  );
}

function buildMobileLayout(): UiNode {
  return container(
    [
      navbar("Mobile"),
      container(
        [
          header("Your activity", "A quick summary for today"),
          statsGrid(2),
          card("Recent items", [
            table(
              ["Item", "Status"],
              [
                ["Design review", "Done"],
                ["Landing page", "In progress"],
                ["Handoff", "Queued"],
              ],
            ),
          ]),
          button("Continue"),
        ],
        { flexDirection: "column", gap: 12, padding: 16 },
      ),
    ],
    { flexDirection: "column", padding: 0, backgroundColor: "#F8FAFC" },
  );
}

// --- Node helpers ----------------------------------------------------------

function makeNode(
  type: string,
  props: Record<string, unknown> = {},
  styles?: Record<string, unknown>,
  children?: UiNode[],
): UiNode {
  const definition = componentRegistry[type];
  const baseStyles = definition?.defaultStyles ? { ...definition.defaultStyles } : undefined;
  return {
    id: createId(type.replace(/^[a-z]+\./, "")),
    type,
    name: definition?.label,
    props: { ...(definition?.defaultProps ?? {}), ...props },
    styles: styles ? { ...(baseStyles ?? {}), ...styles } : baseStyles,
    children: children ?? (definition?.isContainer ? [] : undefined),
  };
}

function container(
  children: UiNode[],
  styles: Record<string, unknown>,
  type = "layout.container",
  props: Record<string, unknown> = {},
): UiNode {
  return makeNode(type, props, styles, children);
}

function navbar(title: string): UiNode {
  return makeNode("layout.navbar", { title }, { padding: "0 24px" });
}

function header(title: string, subtitle: string): UiNode {
  return makeNode("dashboard.header", { title, subtitle });
}

function text(value: string, styles?: Record<string, unknown>): UiNode {
  return makeNode("basic.text", { text: value, variant: "body" }, styles);
}

function image(alt: string): UiNode {
  return makeNode("basic.image", { alt }, { width: "100%", height: 220 });
}

function button(label: string): UiNode {
  return makeNode("basic.button", { label, variant: "primary" }, { alignSelf: "flex-start" });
}

function input(label: string, placeholder: string): UiNode {
  return makeNode("basic.input", { label, placeholder, type: "text" });
}

function card(title: string, children: UiNode[]): UiNode {
  return makeNode("formal.card", { title }, undefined, children);
}

function chart(title: string): UiNode {
  return makeNode("dashboard.chart", { title, kind: "bar" }, { height: 220 });
}

function table(headers: string[], rows: string[][]): UiNode {
  return makeNode("dashboard.table", { headers, rows });
}

function statsGrid(columns: number): UiNode {
  return makeNode(
    "layout.grid",
    { columns, gap: 12 },
    { gap: 12 },
    [
      makeNode("dashboard.stats", { items: ["Revenue"], values: ["$45,230"] }),
      makeNode("dashboard.stats", { items: ["Customers"], values: ["2,450"] }),
      makeNode("dashboard.stats", { items: ["Orders"], values: ["1,820"] }),
      makeNode("dashboard.stats", { items: ["Conversion"], values: ["4.2%"] }),
    ],
  );
}
