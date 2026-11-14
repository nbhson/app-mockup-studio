// ---------------------------------------------------------------------------
// AI-generated dummy data (plan/07 3.7).
//
// Fills data-bearing components (stats, table, chart) and generic placeholder
// copy (header, text, button, input, card…) with believable demo content.
// The API uses this deterministic generator when no model is configured, and
// as a fallback when the model returns invalid JSON. No AI key is required.
//
// Safety rules:
//  - only whitelisted prop keys per component type are touched
//  - table rows always match the header column count
//  - stats items/values are parallel arrays
//  - real user copy is preserved; only empty/default-looking copy is filled
// ---------------------------------------------------------------------------

import {
  getComponentDefinition,
  walkTree,
  type UiDocument,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import type {
  DummyDataChange,
  DummyDataLocale,
  DummyDataResult,
} from "@ai-mockup-studio/shared-types";

export type DummyDataTopic =
  | "sales"
  | "customers"
  | "orders"
  | "products"
  | "marketing"
  | "generic";

/** Prop keys the dummy-data feature is allowed to fill, per component type. */
export const DUMMY_DATA_PROPS: Record<string, string[]> = {
  "dashboard.header": ["title", "subtitle"],
  "dashboard.stats": ["items", "values"],
  "dashboard.chart": ["title", "kind"],
  "dashboard.table": ["headers", "rows"],
  "basic.text": ["text"],
  "basic.button": ["label"],
  "basic.input": ["label", "placeholder"],
  "basic.image": ["alt"],
  "formal.card": ["title"],
  "formal.form": ["title"],
  "layout.section": ["title"],
};

const MAX_ARRAY_ITEMS = 8;
const MAX_TABLE_ROWS = 20;
const MAX_STRING_LENGTH = 200;

export interface DummyTarget {
  node: UiNode;
  label: string;
  /** Props that should be filled for this node. */
  props: string[];
}

export interface DummyDataOptions {
  nodeId?: string | null;
  locale?: DummyDataLocale;
  context?: string;
}

// --- Targets ---------------------------------------------------------------

/**
 * Collect nodes that can receive dummy data. When `nodeId` is provided only
 * that node is considered. Real user copy is never overwritten: text-like
 * props are included only when they are empty or still hold a generic default.
 */
export function collectDummyTargets(
  doc: UiDocument,
  options: DummyDataOptions = {},
): DummyTarget[] {
  const { nodeId = null, locale = "vi" } = options;
  const targets: DummyTarget[] = [];

  walkTree(doc.root, (node) => {
    if (node.hidden) return;
    if (nodeId && node.id !== nodeId) return;
    const allowed = DUMMY_DATA_PROPS[node.type];
    if (!allowed) return;

    const props = allowed.filter((key) => shouldFillProp(node, key, locale));
    if (props.length === 0) return;

    targets.push({
      node,
      label: getComponentDefinition(node.type)?.label ?? node.type,
      props,
    });
  });

  return targets;
}

function shouldFillProp(node: UiNode, key: string, locale: DummyDataLocale): boolean {
  const value = (node.props ?? {})[key];

  switch (node.type) {
    case "dashboard.stats":
      // Data components are always refreshed.
      return true;
    case "dashboard.table":
      if (key === "headers") return isGenericHeaders(value);
      return true;
    case "dashboard.chart":
      if (key === "kind") return typeof value !== "string" || value.trim() === "";
      return isGenericText(value, locale, "title");
    default:
      return isGenericText(value, locale, key);
  }
}

function isGenericText(
  value: unknown,
  locale: DummyDataLocale,
  key: string,
): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text === "") return true;
  return genericPatterns(locale, key).test(text);
}

function genericPatterns(locale: DummyDataLocale, key: string): RegExp {
  const vi = locale === "vi";
  switch (key) {
    case "title":
      return vi
        ? /^(tiêu đề|tổng quan|biểu đồ|doanh thu|thẻ|card|form|section|dashboard|untitled|revenue|chart|overview|monthly revenue)$/i
        : /^(title|overview|chart|revenue|card|form|section|dashboard|untitled|monthly revenue)$/i;
    case "subtitle":
      return vi
        ? /^(mô tả|mô tả ngắn|subtitle|today'?s metrics( at a glance)?|số liệu hôm nay)$/i
        : /^(subtitle|description|today'?s metrics( at a glance)?)$/i;
    case "text":
      return /^(text content|text|nội dung|nội dung văn bản|hello world|sample text)$/i;
    case "label":
      return /^(button|input|label|nhãn|nút|tiếp tục)$/i;
    case "placeholder":
      return /^(type here…?|type here\.\.\.|nhập nội dung|placeholder|enter text)$/i;
    case "alt":
      return /^(image|ảnh|image alt|alt)$/i;
    default:
      return /^(—|-|todo|tbd|placeholder)$/i;
  }
}

function isGenericHeaders(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((header) => {
    const text = String(header ?? "").trim();
    return text === "" || /^(name|value|column\s*\d*|field|—|-)$/i.test(text);
  });
}

// --- Heuristic generation --------------------------------------------------

export function heuristicDummyData(
  doc: UiDocument,
  options: DummyDataOptions = {},
): DummyDataResult {
  const { locale = "vi", context } = options;
  const targets = collectDummyTargets(doc, options);

  if (targets.length === 0) {
    return {
      changes: [],
      summary:
        locale === "vi"
          ? "Không tìm thấy thành phần nào cần điền dữ liệu mẫu (nội dung thật được giữ nguyên)."
          : "No components need sample data (real copy is preserved).",
      source: "heuristic",
    };
  }

  const hint = [context, doc.name, headingHint(doc)].filter(Boolean).join(" ");
  const topic = detectTopic(hint);
  const changes = targets.map((target) => buildChange(target, topic, locale));

  return {
    changes,
    summary:
      locale === "vi"
        ? `Đã tạo dữ liệu mẫu cho ${changes.length} thành phần (${topicLabel(topic, locale)}).`
        : `Generated sample data for ${changes.length} components (${topicLabel(topic, locale)}).`,
    source: "heuristic",
  };
}

function buildChange(
  target: DummyTarget,
  topic: DummyDataTopic,
  locale: DummyDataLocale,
): DummyDataChange {
  const { node, props } = target;
  const generated = generateProps(node, topic, locale);
  const selected: Record<string, unknown> = {};
  for (const key of props) {
    if (generated[key] !== undefined) selected[key] = generated[key];
  }
  return {
    nodeId: node.id,
    nodeType: node.type,
    nodeLabel: target.label,
    props: selected,
  };
}

function generateProps(
  node: UiNode,
  topic: DummyDataTopic,
  locale: DummyDataLocale,
): Record<string, unknown> {
  switch (node.type) {
    case "dashboard.stats": {
      const items = statLabels(topic, locale);
      return { items, values: items.map((item) => statValue(item, locale)) };
    }
    case "dashboard.table": {
      const existing = Array.isArray(node.props?.headers)
        ? (node.props.headers as unknown[]).map(String)
        : [];
      const headers = isGenericHeaders(existing)
        ? tableHeaders(topic, locale)
        : existing.slice(0, MAX_ARRAY_ITEMS);
      return { headers, rows: tableRows(headers, locale) };
    }
    case "dashboard.chart":
      return { title: chartTitle(topic, locale), kind: "bar" };
    case "dashboard.header":
      return headerCopy(topic, locale);
    case "basic.text":
      return { text: bodyCopy(topic, locale) };
    case "basic.button":
      return { label: buttonCopy(topic, locale) };
    case "basic.input":
      return inputCopy(topic, locale);
    case "basic.image":
      return { alt: locale === "vi" ? "Ảnh minh họa sản phẩm" : "Product illustration" };
    case "formal.card":
      return { title: cardTitle(topic, locale) };
    case "formal.form":
      return { title: locale === "vi" ? "Thông tin khách hàng" : "Customer information" };
    case "layout.section":
      return { title: sectionTitle(topic, locale) };
    default:
      return {};
  }
}

// --- Sanitizer (AI output) -------------------------------------------------

/**
 * Validate and normalize model-proposed props. Returns null when nothing
 * usable remains. Unknown keys and malformed values are dropped.
 */
export function sanitizeDummyProps(
  nodeType: string,
  props: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowed = DUMMY_DATA_PROPS[nodeType];
  if (!allowed) return null;

  const clean: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in props)) continue;
    const value = sanitizeValue(key, props[key]);
    if (value !== undefined) clean[key] = value;
  }

  // Keep parallel arrays consistent.
  if (Array.isArray(clean.items) && Array.isArray(clean.values)) {
    const length = Math.min(clean.items.length, clean.values.length);
    clean.items = clean.items.slice(0, length);
    clean.values = clean.values.slice(0, length);
  }

  // Every table row must match the header count.
  if (Array.isArray(clean.headers) && Array.isArray(clean.rows)) {
    const columns = clean.headers.length;
    const rows = (clean.rows as unknown[][]).filter(
      (row) => Array.isArray(row) && row.length === columns,
    );
    if (rows.length === 0) delete clean.rows;
    else clean.rows = rows;
  }

  return Object.keys(clean).length > 0 ? clean : null;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (key === "kind") {
    return typeof value === "string" &&
      ["bar", "line", "area", "pie"].includes(value.trim())
      ? value.trim()
      : undefined;
  }

  if (key === "items" || key === "values" || key === "headers") {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
      .filter((item) => item.length > 0)
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => item.slice(0, MAX_STRING_LENGTH));
    return items.length > 0 ? items : undefined;
  }

  if (key === "rows") {
    if (!Array.isArray(value)) return undefined;
    const rows = value
      .slice(0, MAX_TABLE_ROWS)
      .map((row) =>
        Array.isArray(row)
          ? row
              .slice(0, MAX_ARRAY_ITEMS)
              .map((cell) => String(cell ?? "").trim().slice(0, MAX_STRING_LENGTH))
          : [],
      )
      .filter((row) => row.length > 0);
    return rows.length > 0 ? rows : undefined;
  }

  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0) return undefined;
  return text.slice(0, MAX_STRING_LENGTH);
}

// --- Topics & copy ---------------------------------------------------------

export function detectTopic(hint: string): DummyDataTopic {
  const text = hint.toLowerCase();
  if (/đơn hàng|order|giao hàng|shipping|vận chuyển/.test(text)) return "orders";
  if (/khách hàng|customer|user|người dùng|account|tài khoản/.test(text)) {
    return "customers";
  }
  if (/sản phẩm|product|kho|inventory|hàng hóa|catalog/.test(text)) return "products";
  if (/chiến dịch|campaign|marketing|quảng cáo|email/.test(text)) return "marketing";
  if (/doanh thu|revenue|tài chính|finance|bán hàng|sales|báo cáo|report|dashboard/.test(text)) {
    return "sales";
  }
  return "generic";
}

function headingHint(doc: UiDocument): string {
  let hint = "";
  walkTree(doc.root, (node) => {
    if (hint) return;
    if (node.type === "dashboard.header" && typeof node.props?.title === "string") {
      hint = node.props.title;
    }
  });
  return hint;
}

function topicLabel(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const labels: Record<DummyDataTopic, { vi: string; en: string }> = {
    sales: { vi: "bán hàng", en: "sales" },
    customers: { vi: "khách hàng", en: "customers" },
    orders: { vi: "đơn hàng", en: "orders" },
    products: { vi: "sản phẩm", en: "products" },
    marketing: { vi: "marketing", en: "marketing" },
    generic: { vi: "tổng quan", en: "overview" },
  };
  return labels[topic][locale];
}

function statLabels(topic: DummyDataTopic, locale: DummyDataLocale): string[] {
  const vi: Record<DummyDataTopic, string[]> = {
    sales: ["Doanh thu", "Đơn hàng", "Giá trị TB", "Tỷ lệ chuyển đổi"],
    customers: ["Khách hàng mới", "Khách quay lại", "Tỷ lệ giữ chân", "Điểm NPS"],
    orders: ["Đơn mới", "Đang xử lý", "Đã giao", "Tỷ lệ hoàn"],
    products: ["Sản phẩm", "Đã bán", "Tồn kho", "Sắp hết hàng"],
    marketing: ["Lượt hiển thị", "Lượt nhấp", "CTR", "Chi phí/lead"],
    generic: ["Doanh thu", "Người dùng", "Lượt xem", "Tỷ lệ chuyển đổi"],
  };
  const en: Record<DummyDataTopic, string[]> = {
    sales: ["Revenue", "Orders", "Avg. value", "Conversion"],
    customers: ["New customers", "Returning", "Retention", "NPS"],
    orders: ["New orders", "Processing", "Delivered", "Return rate"],
    products: ["Products", "Units sold", "In stock", "Low stock"],
    marketing: ["Impressions", "Clicks", "CTR", "Cost per lead"],
    generic: ["Revenue", "Users", "Page views", "Conversion"],
  };
  return (locale === "vi" ? vi : en)[topic];
}

function statValue(label: string, locale: DummyDataLocale): string {
  const text = label.toLowerCase();
  if (/chi phí\/lead|cost per lead/.test(text)) {
    return formatCurrency(randInt(18, 120) * 1000, locale);
  }
  if (/doanh thu|revenue|chi phí|cost|lợi nhuận|profit|giá trị|value|aov/.test(text)) {
    return formatCurrency(randInt(80, 980) * 100000, locale);
  }
  if (/tỷ lệ|rate|chuyển đổi|conversion|giữ chân|retention|ctr|nps/.test(text)) {
    return `${(randInt(18, 82) / 10).toFixed(1)}%`;
  }
  return groupNumber(randInt(120, 9800), locale);
}

function chartTitle(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const titles: Record<DummyDataTopic, { vi: string; en: string }> = {
    sales: { vi: "Doanh thu theo tháng", en: "Monthly revenue" },
    customers: { vi: "Tăng trưởng khách hàng", en: "Customer growth" },
    orders: { vi: "Đơn hàng theo tuần", en: "Weekly orders" },
    products: { vi: "Sản phẩm bán chạy", en: "Top products" },
    marketing: { vi: "Hiệu quả chiến dịch", en: "Campaign performance" },
    generic: { vi: "Xu hướng 6 tháng", en: "Six-month trend" },
  };
  return titles[topic][locale];
}

function headerCopy(
  topic: DummyDataTopic,
  locale: DummyDataLocale,
): Record<string, unknown> {
  const copy: Record<DummyDataTopic, { vi: [string, string]; en: [string, string] }> = {
    sales: {
      vi: ["Tổng quan bán hàng", "Doanh thu và đơn hàng trong 30 ngày gần nhất"],
      en: ["Sales overview", "Revenue and orders over the last 30 days"],
    },
    customers: {
      vi: ["Khách hàng", "Chân dung và mức độ gắn kết của khách hàng"],
      en: ["Customers", "Customer profiles and engagement"],
    },
    orders: {
      vi: ["Đơn hàng", "Theo dõi trạng thái xử lý và giao hàng"],
      en: ["Orders", "Track fulfillment and delivery status"],
    },
    products: {
      vi: ["Sản phẩm", "Tình hình bán ra và tồn kho"],
      en: ["Products", "Sales and inventory status"],
    },
    marketing: {
      vi: ["Chiến dịch", "Hiệu suất kênh và chi phí tiếp cận"],
      en: ["Campaigns", "Channel performance and acquisition cost"],
    },
    generic: {
      vi: ["Tổng quan", "Các chỉ số chính trong kỳ"],
      en: ["Overview", "Key metrics for the period"],
    },
  };
  const [title, subtitle] = copy[topic][locale];
  return { title, subtitle };
}

function bodyCopy(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const samples: Record<DummyDataTopic, { vi: string[]; en: string[] }> = {
    sales: {
      vi: [
        "Doanh thu tăng 12,4% so với tháng trước nhờ nhóm khách hàng quay lại.",
        "Đơn hàng giá trị cao tập trung ở khu vực miền Nam trong tuần này.",
      ],
      en: [
        "Revenue is up 12.4% month over month, driven by returning customers.",
        "High-value orders are concentrated in the southern region this week.",
      ],
    },
    customers: {
      vi: [
        "Nhóm khách hàng trung thành đóng góp 38% tổng doanh thu.",
        "Tỷ lệ giữ chân tăng nhẹ sau khi cải thiện quy trình onboarding.",
      ],
      en: [
        "Loyal customers contribute 38% of total revenue.",
        "Retention improved slightly after the onboarding revamp.",
      ],
    },
    orders: {
      vi: [
        "92% đơn hàng được giao đúng hẹn trong 7 ngày qua.",
        "Số đơn đang xử lý giảm sau khi bổ sung nhân sự kho.",
      ],
      en: [
        "92% of orders were delivered on time in the last 7 days.",
        "Orders in progress dropped after adding warehouse staff.",
      ],
    },
    products: {
      vi: [
        "Ba sản phẩm bán chạy nhất chiếm gần một nửa số lượng xuất kho.",
        "Một số mặt hàng sắp hết cần được bổ sung trong tuần này.",
      ],
      en: [
        "The top three products account for nearly half of units shipped.",
        "Several items are running low and need restocking this week.",
      ],
    },
    marketing: {
      vi: [
        "Kênh email mang lại chi phí trên mỗi lead thấp nhất trong tháng.",
        "Chiến dịch retargeting có tỷ lệ chuyển đổi cao hơn 1,8 lần.",
      ],
      en: [
        "Email delivered the lowest cost per lead this month.",
        "The retargeting campaign converted 1.8× better than average.",
      ],
    },
    generic: {
      vi: [
        "Các chỉ số chính đang ổn định và không có biến động bất thường.",
        "Dữ liệu được tổng hợp từ hoạt động của người dùng trong 30 ngày.",
      ],
      en: [
        "Key metrics are stable with no unusual changes.",
        "Data is aggregated from user activity over the last 30 days.",
      ],
    },
  };
  return pick(samples[topic][locale]);
}

function buttonCopy(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const labels: Record<DummyDataTopic, { vi: string[]; en: string[] }> = {
    sales: { vi: ["Xem báo cáo", "Xuất dữ liệu"], en: ["View report", "Export data"] },
    customers: { vi: ["Thêm khách hàng", "Xem hồ sơ"], en: ["Add customer", "View profile"] },
    orders: { vi: ["Tạo đơn hàng", "Xử lý đơn"], en: ["Create order", "Process order"] },
    products: { vi: ["Thêm sản phẩm", "Cập nhật kho"], en: ["Add product", "Update stock"] },
    marketing: { vi: ["Tạo chiến dịch", "Xem hiệu suất"], en: ["Create campaign", "View performance"] },
    generic: { vi: ["Xem chi tiết", "Tiếp tục"], en: ["View details", "Continue"] },
  };
  return pick(labels[topic][locale]);
}

function inputCopy(
  topic: DummyDataTopic,
  locale: DummyDataLocale,
): Record<string, unknown> {
  if (topic === "customers") {
    return locale === "vi"
      ? { label: "Email khách hàng", placeholder: "khachhang@congty.vn" }
      : { label: "Customer email", placeholder: "customer@company.com" };
  }
  if (topic === "orders") {
    return locale === "vi"
      ? { label: "Mã đơn hàng", placeholder: "ORD-1024" }
      : { label: "Order ID", placeholder: "ORD-1024" };
  }
  if (topic === "products") {
    return locale === "vi"
      ? { label: "Tên sản phẩm", placeholder: "Tai nghe không dây" }
      : { label: "Product name", placeholder: "Wireless headphones" };
  }
  return locale === "vi"
    ? { label: "Tên khách hàng", placeholder: "Nguyễn Minh Anh" }
    : { label: "Customer name", placeholder: "Alex Morgan" };
}

function cardTitle(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const titles: Record<DummyDataTopic, { vi: string; en: string }> = {
    sales: { vi: "Đơn hàng gần đây", en: "Recent orders" },
    customers: { vi: "Khách hàng nổi bật", en: "Top customers" },
    orders: { vi: "Đơn hàng đang xử lý", en: "Orders in progress" },
    products: { vi: "Sản phẩm bán chạy", en: "Best sellers" },
    marketing: { vi: "Hiệu suất kênh", en: "Channel performance" },
    generic: { vi: "Chi tiết", en: "Details" },
  };
  return titles[topic][locale];
}

function sectionTitle(topic: DummyDataTopic, locale: DummyDataLocale): string {
  const titles: Record<DummyDataTopic, { vi: string; en: string }> = {
    sales: { vi: "Phân tích doanh thu", en: "Revenue analysis" },
    customers: { vi: "Phân khúc khách hàng", en: "Customer segments" },
    orders: { vi: "Luồng xử lý đơn", en: "Order pipeline" },
    products: { vi: "Danh mục sản phẩm", en: "Product catalog" },
    marketing: { vi: "Kênh tiếp cận", en: "Acquisition channels" },
    generic: { vi: "Nội dung chính", en: "Main content" },
  };
  return titles[topic][locale];
}

// --- Table generation ------------------------------------------------------

function tableHeaders(topic: DummyDataTopic, locale: DummyDataLocale): string[] {
  const headers: Record<DummyDataTopic, { vi: string[]; en: string[] }> = {
    sales: {
      vi: ["Khách hàng", "Gói dịch vụ", "Giá trị", "Trạng thái"],
      en: ["Customer", "Plan", "Amount", "Status"],
    },
    customers: {
      vi: ["Khách hàng", "Email", "Ngày tham gia", "Trạng thái"],
      en: ["Customer", "Email", "Joined", "Status"],
    },
    orders: {
      vi: ["Mã đơn", "Khách hàng", "Giá trị", "Trạng thái"],
      en: ["Order", "Customer", "Amount", "Status"],
    },
    products: {
      vi: ["Sản phẩm", "Danh mục", "Giá", "Tồn kho"],
      en: ["Product", "Category", "Price", "Stock"],
    },
    marketing: {
      vi: ["Chiến dịch", "Kênh", "Chi phí", "Trạng thái"],
      en: ["Campaign", "Channel", "Cost", "Status"],
    },
    generic: {
      vi: ["Tên", "Mô tả", "Giá trị", "Trạng thái"],
      en: ["Name", "Description", "Value", "Status"],
    },
  };
  return headers[topic][locale];
}

type ColumnKind =
  | "name"
  | "email"
  | "amount"
  | "status"
  | "date"
  | "product"
  | "plan"
  | "phone"
  | "id"
  | "number"
  | "text";

function columnKind(header: string): ColumnKind {
  const h = header.toLowerCase();
  if (/email|e-mail/.test(h)) return "email";
  if (/status|trạng thái|state/.test(h)) return "status";
  if (/date|ngày|joined|created|updated/.test(h)) return "date";
  if (/amount|price|revenue|total|value|cost|giá|doanh thu|số tiền|chi phí/.test(h)) {
    return "amount";
  }
  if (/plan|gói/.test(h)) return "plan";
  if (/product|sản phẩm|item|hàng hóa|campaign|chiến dịch/.test(h)) return "product";
  if (/phone|sđt|điện thoại/.test(h)) return "phone";
  if (/^id$|mã|code|order/.test(h)) return "id";
  if (/stock|tồn kho|qty|quantity|số lượng|count/.test(h)) return "number";
  if (/name|tên|khách hàng|customer|user|người dùng|channel|kênh/.test(h)) {
    return "name";
  }
  return "text";
}

function tableRows(headers: string[], locale: DummyDataLocale): string[][] {
  const kinds = headers.map(columnKind);
  const rows: string[][] = [];
  for (let i = 0; i < 4; i += 1) {
    rows.push(kinds.map((kind) => cellValue(kind, locale)));
  }
  return rows;
}

function cellValue(kind: ColumnKind, locale: DummyDataLocale): string {
  switch (kind) {
    case "name":
      return pick(locale === "vi" ? VI_NAMES : EN_NAMES);
    case "email": {
      const name = pick(locale === "vi" ? VI_NAMES : EN_NAMES);
      return `${slug(name)}@${pick(["example.com", "congty.vn", "mail.vn"])}`;
    }
    case "amount":
      return formatCurrency(randInt(120, 9800) * 1000, locale);
    case "status":
      return pick(locale === "vi" ? VI_STATUSES : EN_STATUSES);
    case "date":
      return formatDate(locale);
    case "product":
      return pick(locale === "vi" ? VI_PRODUCTS : EN_PRODUCTS);
    case "plan":
      return pick(["Starter", "Pro", "Enterprise"]);
    case "phone":
      return `09${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}`;
    case "id":
      return `#ORD-${randInt(1000, 9999)}`;
    case "number":
      return groupNumber(randInt(4, 240), locale);
    default:
      return pick(locale === "vi" ? VI_NOTES : EN_NOTES);
  }
}

// --- Pools -----------------------------------------------------------------

const VI_NAMES = [
  "Nguyễn Minh Anh",
  "Trần Quốc Bảo",
  "Lê Thu Hà",
  "Phạm Gia Hân",
  "Hoàng Đức Long",
  "Vũ Khánh Linh",
  "Đặng Nhật Minh",
  "Bùi Thanh Tâm",
];

const EN_NAMES = [
  "Alex Morgan",
  "Jamie Chen",
  "Taylor Brooks",
  "Jordan Patel",
  "Casey Nguyen",
  "Riley Thompson",
  "Morgan Lee",
  "Avery Garcia",
];

const VI_PRODUCTS = [
  "Tai nghe không dây",
  "Bàn phím cơ",
  "Chuột không dây",
  "Màn hình 27 inch",
  "Đế sạc nhanh",
  "Camera an ninh",
  "Loa bluetooth",
  "Ổ cứng SSD",
];

const EN_PRODUCTS = [
  "Wireless headphones",
  "Mechanical keyboard",
  "Wireless mouse",
  "27-inch monitor",
  "Fast charging dock",
  "Security camera",
  "Bluetooth speaker",
  "SSD drive",
];

const VI_STATUSES = ["Hoàn tất", "Đang xử lý", "Chờ duyệt", "Đã hủy"];
const EN_STATUSES = ["Completed", "Processing", "Pending", "Cancelled"];

const VI_NOTES = ["Ghi chú nội bộ", "Ưu tiên cao", "Khách quay lại", "Cần theo dõi"];
const EN_NOTES = ["Internal note", "High priority", "Returning customer", "Follow up"];

// --- Helpers ---------------------------------------------------------------

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function groupNumber(value: number, locale: DummyDataLocale): string {
  const separator = locale === "vi" ? "." : ",";
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function formatCurrency(value: number, locale: DummyDataLocale): string {
  return locale === "vi" ? `${groupNumber(value, locale)} ₫` : `$${groupNumber(value, locale)}`;
}

function formatDate(locale: DummyDataLocale): string {
  const day = randInt(1, 28);
  const month = randInt(1, 12);
  if (locale === "vi") {
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/2026`;
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[month - 1]} ${day}, 2026`;
}

function slug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}
