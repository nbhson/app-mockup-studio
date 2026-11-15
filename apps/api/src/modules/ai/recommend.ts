// ---------------------------------------------------------------------------
// AI component recommendation (plan/07 3.9).
//
// Suggests the next components to add based on the user's goal and the current
// document. The API uses this deterministic analyzer when no model is
// configured, and as a fallback when the model returns invalid JSON.
// No AI key is required.
// ---------------------------------------------------------------------------

import {
  collectDistinctTypes,
  componentRegistry,
  getComponentDefinition,
  walkTree,
  type UiDocument,
} from "@ai-mockup-studio/ui-schema";
import type {
  ComponentRecommendResult,
  ComponentRecommendation,
} from "@ai-mockup-studio/shared-types";

interface IntentRule {
  id: string;
  pattern: RegExp;
  /** Component types this intent calls for, in priority order. */
  types: Array<{ type: string; score: number }>;
  reason: string;
}

/** Word-boundary matcher that also works with Vietnamese diacritics. */
function intent(pattern: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`,
    "iu",
  );
}

const INTENT_RULES: IntentRule[] = [
  {
    id: "stats",
    pattern: intent(
      "kpi|metric|metrics|số liệu|chỉ số|thống kê|doanh thu|revenue|sales|dashboard|tổng quan|overview",
    ),
    types: [{ type: "dashboard.stats", score: 82 }],
    reason: "Màn hình cần các chỉ số nổi bật để người dùng nắm tình hình trong vài giây.",
  },
  {
    id: "chart",
    pattern: intent("chart|biểu đồ|đồ thị|xu hướng|trend|analytics|phân tích"),
    types: [{ type: "dashboard.chart", score: 78 }],
    reason: "Dữ liệu có yếu tố xu hướng nên cần biểu đồ để so sánh theo thời gian.",
  },
  {
    id: "table",
    pattern: intent(
      "table|bảng|danh sách|list|records|đơn hàng|orders|khách hàng|customers|giao dịch|transactions",
    ),
    types: [{ type: "dashboard.table", score: 76 }],
    reason: "Nội dung dạng danh sách nhiều dòng phù hợp với component bảng.",
  },
  {
    id: "form",
    pattern: intent(
      "form|biểu mẫu|đăng ký|đăng nhập|sign\\s?up|login|nhập liệu|checkout|thanh toán|payment|contact|liên hệ",
    ),
    types: [
      { type: "formal.form", score: 88 },
      { type: "basic.input", score: 72 },
      { type: "basic.button", score: 64 },
    ],
    reason: "Luồng nhập liệu cần form, trường nhập và nút hành động đi kèm.",
  },
  {
    id: "header",
    pattern: intent("header|tiêu đề|title|hero|landing"),
    types: [{ type: "dashboard.header", score: 72 }],
    reason: "Trang cần tiêu đề rõ ràng để tạo điểm neo thị giác đầu tiên.",
  },
  {
    id: "card",
    pattern: intent("card|thẻ|sản phẩm|product|pricing|gói|plan"),
    types: [{ type: "formal.card", score: 68 }],
    reason: "Nội dung dạng khối sản phẩm/gói dịch vụ phù hợp với card.",
  },
  {
    id: "image",
    pattern: intent("image|ảnh|hình|banner|gallery|photo"),
    types: [{ type: "basic.image", score: 68 }],
    reason: "Nội dung trực quan cần ảnh/banner để tăng sức hút.",
  },
  {
    id: "text",
    pattern: intent("text|nội dung|mô tả|description|paragraph|article|blog"),
    types: [{ type: "basic.text", score: 58 }],
    reason: "Cần khối văn bản để giải thích hoặc mô tả nội dung.",
  },
  {
    id: "sidebar",
    pattern: intent("sidebar|menu|điều hướng|navigation|nav"),
    types: [{ type: "layout.sidebar", score: 64 }],
    reason: "Ứng dụng nhiều mục cần sidebar để điều hướng ổn định.",
  },
  {
    id: "navbar",
    pattern: intent("navbar|thanh điều hướng|topbar|header bar"),
    types: [{ type: "layout.navbar", score: 64 }],
    reason: "Cần thanh điều hướng ngang cho các hành động chính.",
  },
  {
    id: "grid",
    pattern: intent("grid|lưới|layout|bố cục|columns|cột"),
    types: [{ type: "layout.grid", score: 56 }],
    reason: "Bố cục nhiều khối nên dùng grid để giữ nhịp và tự wrap trên mobile.",
  },
  {
    id: "button",
    pattern: intent("nút|button|cta|action|hành động"),
    types: [{ type: "basic.button", score: 58 }],
    reason: "Cần một điểm nhấn hành động rõ ràng cho người dùng.",
  },
];

const MAX_DEFAULT = 6;

export function heuristicRecommendations(
  doc: UiDocument,
  prompt = "",
  max = MAX_DEFAULT,
): ComponentRecommendResult {
  const context = [prompt, doc.name, collectText(doc)].join(" ");
  const existing = new Set(collectDistinctTypes(doc.root));
  const scores = new Map<string, { score: number; reason: string }>();

  const add = (type: string, score: number, reason: string) => {
    if (!componentRegistry[type]) return;
    const current = scores.get(type);
    if (!current || score > current.score) scores.set(type, { score, reason });
  };

  const matched = INTENT_RULES.filter((rule) => rule.pattern.test(context));
  for (const rule of matched) {
    for (const entry of rule.types) {
      add(entry.type, entry.score, rule.reason);
    }
  }

  const wantsData = matched.some((rule) =>
    ["stats", "chart", "table"].includes(rule.id),
  );
  const wantsForm = matched.some((rule) => rule.id === "form");
  const wantsList = matched.some((rule) => rule.id === "table");
  const wantsImage = matched.some((rule) => rule.id === "image");

  // --- Document gap rules --------------------------------------------------
  if (!existing.has("dashboard.header")) {
    add(
      "dashboard.header",
      prompt ? 55 : 66,
      "Trang chưa có heading/tiêu đề nên thiếu điểm neo thị giác cho người dùng.",
    );
  }
  if (wantsData && !existing.has("dashboard.stats")) {
    add(
      "dashboard.stats",
      74,
      "Bố cục dạng dashboard nên có hàng chỉ số tóm tắt phía trên nội dung.",
    );
  }
  if (wantsData && !existing.has("dashboard.chart")) {
    add(
      "dashboard.chart",
      66,
      "Thiếu biểu đồ để thể hiện xu hướng của dữ liệu đang có.",
    );
  }
  if (wantsList && !existing.has("dashboard.table")) {
    add(
      "dashboard.table",
      72,
      "Danh sách nhiều bản ghi nên được trình bày bằng bảng để dễ quét.",
    );
  }
  if (wantsForm && !existing.has("formal.form")) {
    add(
      "formal.form",
      84,
      "Mục tiêu có luồng nhập liệu nhưng trang chưa có form.",
    );
  }
  if (wantsForm && !existing.has("basic.input")) {
    add(
      "basic.input",
      68,
      "Form cần trường nhập để người dùng điền thông tin.",
    );
  }
  if (
    (wantsForm || matched.some((rule) => rule.id === "card")) &&
    !existing.has("basic.button")
  ) {
    add(
      "basic.button",
      54,
      "Cần nút hành động để hoàn tất luồng người dùng.",
    );
  }
  if (wantsImage && !existing.has("basic.image")) {
    add(
      "basic.image",
      64,
      "Nội dung trực quan sẽ rõ hơn khi có ảnh/banner minh họa.",
    );
  }

  // --- Generic fallback when nothing matched ------------------------------
  if (matched.length === 0) {
    if (!existing.has("basic.text")) {
      add("basic.text", 46, "Thêm đoạn mô tả ngắn để giải thích nội dung chính.");
    }
    if (!existing.has("basic.button")) {
      add("basic.button", 40, "Thêm nút hành động chính cho người dùng.");
    }
  }

  // Components already present are still valid to add again, but rank lower.
  const suggestions: ComponentRecommendation[] = [...scores]
    .map(([type, entry]) => {
      const definition = getComponentDefinition(type);
      return {
        type,
        label: definition?.label ?? type,
        category: definition?.category ?? "basic",
        reason: entry.reason,
        score: Math.max(
          10,
          Math.min(100, existing.has(type) ? entry.score - 25 : entry.score),
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  const summary =
    suggestions.length === 0
      ? "Chưa tìm thấy component phù hợp để gợi ý."
      : prompt.trim()
        ? `Gợi ý ${suggestions.length} component phù hợp với "${prompt.trim().slice(0, 80)}".`
        : `Gợi ý ${suggestions.length} component còn thiếu dựa trên bố cục hiện tại.`;

  return { suggestions, summary, source: "heuristic" };
}

/** Collect a short text hint from visible copy in the document. */
function collectText(doc: UiDocument): string {
  const parts: string[] = [];
  walkTree(doc.root, (node) => {
    if (node.hidden || parts.length >= 20) return;
    for (const key of ["text", "title", "subtitle", "label", "placeholder"]) {
      const value = node.props?.[key];
      if (typeof value === "string" && value.trim().length > 0) {
        parts.push(value.trim().slice(0, 80));
      }
    }
  });
  return parts.join(" ");
}
