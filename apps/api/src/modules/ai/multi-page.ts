// ---------------------------------------------------------------------------
// AI multi-page generation (plan/07 3.4).
//
// One prompt → several linked pages that share a single theme. The offline
// builder covers the two most common archetypes (product app and marketing
// site) so the feature works without an API key. Every page includes the same
// navigation labels, which the studio's page switcher and preview use.
// ---------------------------------------------------------------------------

import {
  SCHEMA_VERSION,
  componentRegistry,
  createId,
  type Theme,
  type UiDocument,
  type UiNode,
  type ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { baseTheme } from "../../sample-documents";

const VIEWPORTS: Record<ViewportMode, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

type Archetype = "app" | "landing";

interface PageBlueprint {
  name: string;
  slug: string;
  build: (ctx: BuildContext) => UiNode;
}

interface BuildContext {
  productName: string;
  links: Array<{ name: string; slug: string }>;
  activeSlug: string;
  viewportMode: ViewportMode;
}

export interface MultiPageInput {
  prompt: string;
  pageCount: number;
  viewportMode?: ViewportMode;
}

export interface HeuristicMultiPageResult {
  pages: Array<{ name: string; slug: string; document: UiDocument }>;
  theme: Theme;
  summary: string;
}

const APP_PAGES: PageBlueprint[] = [
  {
    name: "Tổng quan",
    slug: "overview",
    build: (ctx) =>
      pageShell(ctx, [
        header("Tổng quan", `Tình hình kinh doanh của ${ctx.productName} hôm nay`),
        stats(),
        card("Doanh thu theo tháng", [chart("Doanh thu")]),
        card("Hoạt động gần đây", [activityTable()]),
      ]),
  },
  {
    name: "Dự án",
    slug: "projects",
    build: (ctx) =>
      pageShell(ctx, [
        header("Dự án", "Theo dõi tiến độ và trạng thái các dự án"),
        stats(),
        card("Danh sách dự án", [projectsTable()]),
      ]),
  },
  {
    name: "Báo cáo",
    slug: "reports",
    build: (ctx) =>
      pageShell(ctx, [
        header("Báo cáo", "Phân tích xu hướng theo thời gian"),
        stats(),
        card("Tăng trưởng", [chart("Tăng trưởng")]),
        card("Nguồn khách hàng", [chart("Nguồn khách hàng")]),
      ]),
  },
  {
    name: "Đội ngũ",
    slug: "team",
    build: (ctx) =>
      pageShell(ctx, [
        header("Đội ngũ", "Thành viên và quyền truy cập"),
        card("Thành viên", [teamTable()]),
        button("Mời thành viên"),
      ]),
  },
  {
    name: "Cài đặt",
    slug: "settings",
    build: (ctx) =>
      pageShell(ctx, [
        header("Cài đặt", `Tuỳ chỉnh ${ctx.productName}`),
        card("Thông tin chung", [
          input("Tên tổ chức", ctx.productName),
          input("Email liên hệ", "hello@example.com"),
          button("Lưu thay đổi"),
        ]),
        card("Thông báo", [
          text("Nhận email khi có hoạt động quan trọng trong dự án."),
          button("Bật thông báo"),
        ]),
      ]),
  },
];

const LANDING_PAGES: PageBlueprint[] = [
  {
    name: "Trang chủ",
    slug: "home",
    build: (ctx) =>
      pageShell(
        ctx,
        [
          hero(ctx.productName, `Giải pháp hiện đại cho ${ctx.productName.toLowerCase()}`),
          featureGrid(3),
          card("Vì sao chọn chúng tôi", [
            text("Thiết kế nhất quán, hiệu năng cao và quy trình rõ ràng."),
            button("Bắt đầu miễn phí"),
          ]),
        ],
      ),
  },
  {
    name: "Tính năng",
    slug: "features",
    build: (ctx) =>
      pageShell(ctx, [
        header("Tính năng", `Mọi thứ ${ctx.productName} có thể làm`),
        featureGrid(6),
      ]),
  },
  {
    name: "Bảng giá",
    slug: "pricing",
    build: (ctx) =>
      pageShell(ctx, [
        header("Bảng giá", "Chọn gói phù hợp với đội ngũ của bạn"),
        pricingGrid(),
      ]),
  },
  {
    name: "Liên hệ",
    slug: "contact",
    build: (ctx) =>
      pageShell(ctx, [
        header("Liên hệ", "Chúng tôi phản hồi trong vòng một ngày làm việc"),
        card("Gửi tin nhắn", [
          input("Họ tên", "Nguyễn Văn A"),
          input("Email", "you@example.com"),
          input("Nội dung", "Tôi muốn tìm hiểu thêm…"),
          button("Gửi"),
        ]),
      ]),
  },
  {
    name: "Giới thiệu",
    slug: "about",
    build: (ctx) =>
      pageShell(ctx, [
        header("Giới thiệu", `Câu chuyện của ${ctx.productName}`),
        text(
          "Chúng tôi xây dựng sản phẩm giúp đội ngũ thiết kế và phát triển làm việc nhanh hơn.",
        ),
        stats(),
        card("Giá trị cốt lõi", [
          text("Minh bạch, nhất quán và tập trung vào người dùng."),
        ]),
      ]),
  },
];

export function heuristicMultiPage(input: MultiPageInput): HeuristicMultiPageResult {
  const prompt = input.prompt.trim();
  const pageCount = Math.max(2, Math.min(5, input.pageCount));
  const archetype = inferArchetype(prompt);
  const blueprints = (archetype === "landing" ? LANDING_PAGES : APP_PAGES).slice(
    0,
    pageCount,
  );
  const productName = inferProductName(prompt, archetype);
  const theme = { ...baseTheme() };
  const viewportMode = input.viewportMode ?? "desktop";
  const links = blueprints.map((page) => ({ name: page.name, slug: page.slug }));

  const pages = blueprints.map((page) => {
    const ctx: BuildContext = {
      productName,
      links,
      activeSlug: page.slug,
      viewportMode,
    };
    const root = page.build(ctx);
    const document: UiDocument = {
      schemaVersion: SCHEMA_VERSION,
      id: createId("doc"),
      pageId: createId("page"),
      name: page.name,
      viewport: VIEWPORTS[viewportMode],
      theme: { ...theme },
      root,
    };
    return { name: page.name, slug: page.slug, document };
  });

  return {
    pages,
    theme,
    summary: `Đã tạo ${pages.length} trang (${pages
      .map((page) => page.name)
      .join(", ")}) dùng chung một bộ design token và điều hướng.`,
  };
}

function inferArchetype(prompt: string): Archetype {
  return /(landing|marketing|giới thiệu|bán hàng|shop|ecommerce|sản phẩm|product|pricing|bảng giá|nhà hàng|restaurant|agency|portfolio)/i.test(
    prompt,
  )
    ? "landing"
    : "app";
}

function inferProductName(prompt: string, archetype: Archetype): string {
  const cleaned = prompt
    .replace(/^(tạo|thiết kế|make|create|build|generate)\s+/i, "")
    .split(/[.,\n]/)[0]
    .trim();
  if (cleaned.length > 0) return cleaned.slice(0, 48);
  return archetype === "landing" ? "Acme" : "Workspace";
}

// --- Page composition ------------------------------------------------------

function pageShell(ctx: BuildContext, content: UiNode[]): UiNode {
  const body = makeNode(
    "layout.container",
    {},
    {
      flexDirection: "column",
      gap: 24,
      padding: ctx.viewportMode === "mobile" ? 16 : 32,
      flex: 1,
      backgroundColor: "#F8FAFC",
    },
    content,
  );
  return makeNode(
    "layout.container",
    {},
    {
      flexDirection: "column",
      padding: 0,
      minHeight: VIEWPORTS[ctx.viewportMode].height,
      backgroundColor: "#F8FAFC",
    },
    [navbar(ctx), body],
  );
}

function navbar(ctx: BuildContext): UiNode {
  return makeNode(
    "layout.navbar",
    { title: ctx.productName },
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      padding: "14px 24px",
      backgroundColor: "#FFFFFF",
      borderColor: "#E2E8F0",
      borderWidth: 1,
    },
    [
      text(ctx.productName, { fontWeight: 700, color: "#0F172A", fontSize: 16 }),
      makeNode(
        "layout.container",
        {},
        { display: "flex", flexDirection: "row", gap: 18, alignItems: "center" },
        ctx.links.map((link) =>
          text(link.name, {
            fontSize: 13,
            fontWeight: link.slug === ctx.activeSlug ? 700 : 500,
            color: link.slug === ctx.activeSlug ? "#2563EB" : "#64748B",
          }),
        ),
      ),
    ],
  );
}

function hero(title: string, subtitle: string): UiNode {
  return makeNode(
    "layout.container",
    {},
    { flexDirection: "column", gap: 12, padding: "32px 0" },
    [
      header(title, subtitle),
      text("Thiết kế đẹp, tốc độ nhanh và dễ dàng mở rộng cho mọi đội ngũ."),
      button("Bắt đầu ngay"),
    ],
  );
}

function featureGrid(count: number): UiNode {
  const titles = [
    "Nhanh chóng",
    "Linh hoạt",
    "Nhất quán",
    "Bảo mật",
    "Cộng tác",
    "Mở rộng",
  ];
  return makeNode(
    "layout.grid",
    { columns: count > 3 ? 3 : count, gap: 16 },
    { gap: 16 },
    titles.slice(0, count).map((title) =>
      card(title, [
        text("Một khối nội dung ngắn gọn, dễ đọc và giữ đúng nhịp thiết kế."),
      ]),
    ),
  );
}

function pricingGrid(): UiNode {
  const plans = [
    { name: "Starter", price: "$0", note: "Cho cá nhân" },
    { name: "Pro", price: "$19", note: "Cho đội ngũ nhỏ" },
    { name: "Enterprise", price: "$99", note: "Cho tổ chức" },
  ];
  return makeNode(
    "layout.grid",
    { columns: 3, gap: 16 },
    { gap: 16 },
    plans.map((plan) =>
      card(plan.name, [
        text(plan.price, { fontSize: 32, fontWeight: 700, color: "#0F172A" }),
        text(plan.note),
        button("Chọn gói"),
      ]),
    ),
  );
}

function stats(): UiNode {
  return makeNode(
    "layout.grid",
    { columns: 4, gap: 12 },
    { gap: 12 },
    [
      makeNode("dashboard.stats", { items: ["Doanh thu"], values: ["$45,230"] }),
      makeNode("dashboard.stats", { items: ["Khách hàng"], values: ["2,450"] }),
      makeNode("dashboard.stats", { items: ["Đơn hàng"], values: ["1,820"] }),
      makeNode("dashboard.stats", { items: ["Chuyển đổi"], values: ["4.2%"] }),
    ],
  );
}

function activityTable(): UiNode {
  return makeNode("dashboard.table", {
    headers: ["Khách hàng", "Gói", "Trạng thái"],
    rows: [
      ["Acme Corp", "Enterprise", "Hoạt động"],
      ["Globex", "Pro", "Hoạt động"],
      ["Initech", "Starter", "Dùng thử"],
    ],
  });
}

function projectsTable(): UiNode {
  return makeNode("dashboard.table", {
    headers: ["Dự án", "Chủ sở hữu", "Tiến độ", "Trạng thái"],
    rows: [
      ["Landing page", "Minh", "80%", "Đang làm"],
      ["Mobile app", "Lan", "45%", "Đang làm"],
      ["Design system", "Huy", "100%", "Hoàn thành"],
    ],
  });
}

function teamTable(): UiNode {
  return makeNode("dashboard.table", {
    headers: ["Thành viên", "Vai trò", "Email"],
    rows: [
      ["Nguyễn Minh", "Owner", "minh@example.com"],
      ["Trần Lan", "Editor", "lan@example.com"],
      ["Lê Huy", "Viewer", "huy@example.com"],
    ],
  });
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

function header(title: string, subtitle: string): UiNode {
  return makeNode("dashboard.header", { title, subtitle });
}

function text(value: string, styles?: Record<string, unknown>): UiNode {
  return makeNode("basic.text", { text: value, variant: "body" }, styles);
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
  return makeNode("dashboard.chart", { title, kind: "bar" }, { height: 200 });
}
