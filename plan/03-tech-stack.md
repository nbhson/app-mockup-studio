# 03 — Tech Stack khuyến nghị

> Nguồn: mục #3 của hội thoại ChatGPT + phân tích mở rộng.

---

## Tổng quan lựa chọn

Ưu tiên một stack **hiện đại**, phù hợp để xây dựng sản phẩm lâu dài nhưng **không quá phức tạp cho MVP**.

---

## 3.1 Frontend

| Technology | Responsibility | Priority |
|------------|----------------|----------|
| **Vue 3.5+** | Main application | Core |
| **TypeScript** | Type safety | Core |
| **Vite** | Build tooling | Core |
| **Pinia** | Application state | Core |
| **Tailwind CSS** | Styling | Core |
| **shadcn-vue / Reka UI** | UI primitives | Recommended |
| **VueUse** | Utilities and composables | Recommended |
| **interact.js** | Drag, resize, interactions | Recommended |
| **Vue Flow** | Workflow/node editor, nếu cần | Optional |

### Quyết định đáng cân nhắc: Vue hay React?

| Tiêu chí | Vue | React |
|----------|-----|-------|
| **Ưu điểm** | Tận dụng kinh nghiệm và codebase hiện tại | Hệ sinh thái phong phú hơn cho visual editor, drag-and-drop, nhiều thư viện chuyên dụng |
| **Kết luận** | ✅ **Nghiêng về lựa chọn này** | — |

> 💬 Quan điểm ChatGPT: "Tôi nghiêng về **Vue 3 + TypeScript** cho dự án này. **Không nên đổi framework chỉ vì AI đang phổ biến với React.**"

---

## 3.2 Backend

| Technology | Responsibility |
|------------|----------------|
| **Node.js 22+** | Runtime |
| **NestJS** | Backend architecture |
| **TypeScript** | Shared type system |
| **REST API** | CRUD, project, user |
| **SSE** | Streaming AI responses |
| **WebSocket** | Realtime collaboration (sau này) |
| **BullMQ** | Background jobs |
| **Zod** | Runtime validation |

### Tại sao chọn NestJS?

- ✅ Modular architecture.
- ✅ Dependency Injection.
- ✅ Provider abstraction.
- ✅ Guards, interceptors, middleware.
- ✅ Dễ mở rộng AI orchestration thành các module riêng.

---

## 3.3 Database & Infrastructure

| Technology | Responsibility |
|------------|----------------|
| **PostgreSQL** | Users, projects, versions |
| **JSONB** | UI schema storage |
| **Redis** | Cache, queue, session |
| **S3 / Cloudflare R2** | Images, assets, exports |
| **Docker** | Containerization |
| **GitHub Actions / GitLab CI** | CI/CD |
| **Cloudflare** | CDN, DNS, protection |

> ⚠️ **Không khuyến nghị dùng MongoDB ngay từ đầu.** UI document có thể lưu trong **PostgreSQL JSONB**, đồng thời vẫn có relational data cho project, user, permission và version.

---

## 3.4 AI Layer — Phần quan trọng nhất

Đề xuất xây dựng **AI Provider Abstraction** để không phụ thuộc vào một model hoặc vendor cụ thể.

| Provider | Vai trò |
|----------|---------|
| **OpenAI-compatible API** | Cloud/local LLM |
| **Anthropic API** | Coding và reasoning |
| **Google Gemini** | Multimodal, image understanding |
| **llama.cpp** | Local LLM |
| **MLX** | Apple Silicon local inference |
| **Image generation API** | Tạo hình ảnh minh họa, asset |

> Với hệ thống này, có thể dùng **cloud model** cho các tác vụ phức tạp và **local model** cho các tác vụ nhẹ.

### Nguyên tắc cốt lõi

> ⚠️ **Đừng hardcode model vào business logic.**

Hãy có một **ModelRouter** để quyết định model dựa trên:
- Task type.
- Model capabilities.
- Context window.
- Latency.
- Cost.
- Structured output support.

---

## 💡 Phân tích & mở rộng

### Điểm mấu chốt

- **Vue 3 + TypeScript + JSON Schema + AI Provider Abstraction** là điểm xuất phát rất thực tế (tận dụng kinh nghiệm Vue/Angular sẵn có và việc tìm hiểu local LLM qua llama.cpp).
- **ModelRouter** là nơi quyết định "model nào cho tác vụ nào" — thiết kế tốt sẽ giúp tiết kiệm chi phí và cải thiện chất lượng.
- **Custom provider (API key / Base URL / Model)** là tính năng kiến trúc quan trọng ngay từ đầu — xem chi tiết [14-custom-ai-provider.md](./14-custom-ai-provider.md).

### Bảng quyết định Routing đề xuất (ban đầu)

| Task type | Gợi ý model | Ghi chú |
|-----------|-------------|---------|
| UI Generation (text → schema) | Model có structured output / tool calling mạnh | Ưu tiên độ chính xác schema |
| UI Editing (patch) | Model nhanh, latency thấp | Cần đáp ứng tương tác |
| Image Understanding (image-to-UI) | Model có vision | Multimodal |
| Design Analysis | Model mạnh về reasoning | Phân tích, góp ý |

### Câu hỏi mở

1. Dùng **shadcn-vue** hay **Reka UI** (primitives) — hay kết hợp cả hai?
2. Selected: **Tailwind** là styling — có cần design-token mapping sang JSON UI schema riêng của app không? (Xem [05-ui-schema.md](./05-ui-schema.md)).
3. SSE hay WebSocket cho streaming AI về canvas? (SSE cho giai đoạn đầu đơn giản hơn).
