# AI Mockup Studio

> **Một AI-native visual design platform**: người dùng mô tả giao diện bằng ngôn ngữ tự nhiên → AI phân tích yêu cầu → tạo UI mockup → chỉnh sửa qua hội thoại → export thành code / design artifact.

Tài liệu này được **phân tích và document đầy đủ từ cuộc hội thoại ChatGPT** (chia sẻ ngày 10/11/2026), chi tiết tại thư mục [`plan/`](plan/README.md).

---

## 📌 Tóm tắt dự án

**AI Mockup Studio** không được xây dựng như một chatbot sinh HTML/CSS đơn thuần, mà là một **AI-native visual design platform** — trong đó:

| Thành phần | Vai trò |
|------------|---------|
| **AI** | "Bộ não": phân tích yêu cầu, tạo chỉnh sửa giao diện qua hội thoại |
| **Rendering engine + Component engine + Design system** | "Nền tảng": đảm bảo chất lượng đầu ra, có thể chỉnh sửa thủ công |
| **JSON UI Schema** | "Ngôn ngữ chung": AI sinh cấu trúc dữ liệu có schema, không sinh code tùy ý |

### Luồng trải nghiệm người dùng mục tiêu

1. **"Create an enterprise dashboard for managing employees."**
2. AI tạo layout, components, colors và typography.
3. Người dùng chọn một component và yêu cầu AI sửa đổi nó.
4. Người dùng điều chỉnh thủ công qua property inspector.
5. Preview giao diện responsive.
6. Export React/Vue/HTML hoặc chia sẻ preview link.

### 3 nhóm đầu ra (xác định ngay từ đầu)

- **Mockup** — Giao diện trực quan để đánh giá ý tưởng.
- **Prototype** — Giao diện có tương tác, navigation và dữ liệu giả lập.
- **Code** — Source code có cấu trúc, có thể tiếp tục phát triển.

> ⚠️ Đừng cố giải quyết cả ba ở mức hoàn thiện ngay từ MVP.

### 3 trụ cột được ưu tiên xây dựng (theo thứ tự)

1. **UI Schema Engine** — Nền tảng dữ liệu của toàn bộ sản phẩm.
2. **Visual Rendering & Editing Engine** — Biến schema thành giao diện có thể chỉnh sửa.
3. **AI Orchestration Engine** — Tạo & chỉnh sửa giao diện bằng ngôn ngữ tự nhiên.

Ba thành phần phải **được thiết kế độc lập nhưng phối hợp chặt chẽ** với nhau.

---

## 📚 Nội dung tài liệu

| # | Tài liệu | Mô tả |
|---|----------|-------|
| 00 | [Nguồn tham khảo (transcript)](plan/00-nguon-tham-khao.md) | Bản ghi chi tiết cuộc hội thoại ChatGPT gốc |
| 01 | [Product Vision](plan/01-product-vision.md) | Tầm nhìn & mô hình sản phẩm |
| 02 | [Kiến trúc tổng quan](plan/02-architecture.md) | Hệ thống kiến trúc & rendering engine |
| 03 | [Tech Stack](plan/03-tech-stack.md) | Frontend, Backend, Database, AI Layer |
| 04 | [AI Generation Pipeline](plan/04-ai-generation-pipeline.md) | Pipeline Text-to-UI 7 bước |
| 05 | [UI Schema](plan/05-ui-schema.md) | Trái tim của ứng dụng + cơ chế patch |
| 06 | [Frontend Workspace](plan/06-frontend-workspace.md) | Bố cục editor 4 khu vực |
| 07 | [Feature Roadmap](plan/07-feature-roadmap.md) | 4 giai đoạn tính năng + **effort (ideal h)** |
| 08 | [Cấu trúc dự án](plan/08-project-structure.md) | Monorepo pnpm + Turborepo |
| 09 | [Vấn đề kiến trúc cần giải quyết sớm](plan/09-architecture-considerations.md) | Performance, state, AI reliability, security |
| 10 | [Database Design](plan/10-database-design.md) | Entity & ER diagram |
| 11 | [Điều KHÔNG nên làm ngay](plan/11-what-not-to-do.md) | Tránh complexity không cần thiết |
| 12 | [Implementation Roadmap](plan/12-implementation-roadmap.md) | 6 giai đoạn + **effort + acceptance criteria** |
| 13 | [Quyết định cần chốt](plan/13-decisions-to-make.md) | 5 quyết định ảnh hưởng lớn nhất |
| 14 | [Custom AI Provider](plan/14-custom-ai-provider.md) | Provider Adapter Pattern, DB, security |

---

## 🧱 Tech Stack khuyến nghị (tóm tắt)

- **Frontend:** Vue 3.5+ · TypeScript · Vite · Pinia · Tailwind CSS · shadcn-vue/Reka UI · VueUse · interact.js
- **Backend:** Node.js 22+ · NestJS · TypeScript · REST API · SSE (streaming AI) · BullMQ · Zod
- **Database:** PostgreSQL (JSONB chứa UI schema) · Redis · S3/Cloudflare R2 · Docker · CI/CD · Cloudflare
- **AI Layer:** **Provider Abstraction** + **ModelRouter** — khuyến khích **custom provider** (API key, Base URL, Model) ngay từ MVP.

> Lựa chọn nền tảng: **Vue 3 + TypeScript + JSON Schema + AI Provider Abstraction** là điểm xuất phát thực tế (tận dụng kinh nghiệm Vue/Angular sẵn có và việc tìm hiểu local LLM qua llama.cpp).

---

## 🚀 Chạy local

**Yêu cầu:** Node.js 22+, pnpm 12+, PostgreSQL 16+ (hoặc Docker).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # sửa DATABASE_URL nếu cần
pnpm db:migrate                          # tạo bảng bằng Drizzle
pnpm db:seed                             # demo user + CRM dashboard mẫu
pnpm dev                                 # API :3000 · web :5173
```

Khi chưa có `OPENAI_API_KEY`, API tự dùng **mock provider** để toàn bộ luồng
generate/edit chạy được offline. Điền key + `OPENAI_BASE_URL` trong
`apps/api/.env` để dùng LLM thật (tương thích OpenAI API).

### Observability & đánh giá

- `GET /api/health` — readiness probe, trả `503` + `checks.database="down"` khi mất DB.
- `GET /api/metrics` — JSON snapshot: request/latency p50/p95/p99 theo route, lỗi 5xx,
  số lần gọi AI, retry, fallback và token usage. `alerts[]` tự cảnh báo khi vượt
  ngưỡng (`METRICS_ERROR_RATE_THRESHOLD`, `METRICS_P95_MS_THRESHOLD`,
  `METRICS_AI_FALLBACK_THRESHOLD`). Đặt `METRICS_TOKEN` để yêu cầu
  `Authorization: Bearer <token>` trong production.
- `pnpm --filter @ai-mockup-studio/api eval:ai` — chạy test set 8 prompt + 3 edit
  case against API đang chạy; kiểm tra schema, id trùng, viewport, markup lạ,
  intent coverage, fallback rate và lưu report JSON nếu đặt `EVAL_OUT`.
  Với mock provider, kết quả là baseline cấu trúc; điền key để đo LLM thật.
- `pnpm --filter @ai-mockup-studio/api e2e:api` — 192 check HTTP end-to-end:
  project CRUD/duplicate, document save/load, version restore (thuận nghịch),
  isolation giữa project, multi-page CRUD/activate/replace/delete + copy pages,
  public/private share links (password, expiry 410, revoke, cascade),
  comment threads (element/page anchor, reply, resolve, status filter,
  cross-project isolation), custom design systems (token CRUD, apply/switch cho
  mọi trang, detach, cascade delete), component libraries (CRUD, add/update/
  remove component, export/import JSON bundle, unique name/type, schema
  validation), role-based access control (owner/admin/editor/viewer enforcement,
  member management, 403 cho viewer và non-member), team collaboration
  (WebSocket presence 2 user, optimistic concurrency 409 không ghi đè,
  broadcast document update, leave/unknown identity/project), API SDK (typed
  client create/list/read/save, 409 qua MockupError), asset validation/raw
  bytes, copy assets khi duplicate, hidden/locked layer flags, responsive
  overrides, AI
  generate/edit/critique/dummy-data/responsive/recommend-components/image-to-ui/
  url-to-ui (SSRF + redirect)/design-reference/multi-page, metrics.
- `pnpm test` — 224 unit test (API 129, renderer 28, web 61, SDK 6) cho store selection,
  patch/clone, group move, layer lock, diff version, multi-page store,
  share token/password/expiry validation, design system token apply,
  component library serialize/parse, member DTO/role badge helpers,
  presence room roster/dedupe/leave/document broadcast, SDK client request/body/
  error mapping, metrics, rate limit, validation, responsive resolution &
  optimization,
  accessibility & design-consistency analysis, heuristic design critique,
  dummy-data generation, component recommendation, image-to-UI fallback,
  URL parsing & SSRF guards, palette extraction & theme mapping, multi-page
  generation, code export, design-to-code bundle, comment DTO/anchor helpers,
  design system token serialize/parse,
  thu thập asset ảnh và performance guard.
- Performance guard: test `601 nodes` trong `packages/ui-renderer` (resolve +
  export HTML) và đã đo UI thật: render 601 node ~0.9 s, selection ~16 ms.

Runbook deploy production (env, migrate, systemd, Nginx, health, rollback):
[`infrastructure/README.md`](infrastructure/README.md).

---

## 📈 Tình trạng triển khai

- [x] Monorepo pnpm + Turborepo, UI Schema v0.1, component registry, design tokens
- [x] Renderer schema → Vue, canvas, selection, inspector, undo/redo
- [x] Autosave (debounce + revision guard), phím tắt Ctrl+S/Z/Y, Delete
- [x] Drag & drop từ palette/layers; resize có preview và ràng buộc min
- [x] Multi-select (Ctrl/Cmd+click, marquee), copy/paste, di chuyển & xóa nhóm
- [x] Layer tree: đổi tên, di chuyển lên/xuống, ẩn/hiện và khóa layer
- [x] Component palette: tìm kiếm, nhóm theo loại, preview mini
- [x] Design token editor: theme sáng/tối, màu, radius, font áp dụng toàn cục
- [x] AI generate/edit + provider abstraction (mock + OpenAI-compatible)
- [x] Accessibility analysis (WCAG AA): contrast, alt/label, font size, tap target + auto-fix
- [x] AI design critique: điểm 0–100 + phát hiện theo hierarchy/spacing/contrast/token,
  áp dụng gợi ý một click; fallback heuristic khi chưa cấu hình model
- [x] Design consistency audit: spacing/type/radius/color/font-family theo token + auto-fix
- [x] AI dummy data: điền stats/bảng/biểu đồ và copy placeholder bằng dữ liệu thực tế,
  xem trước từng thay đổi, tạo lại hoặc giới hạn theo node đang chọn
- [x] AI responsive optimization: đề xuất override tablet/mobile an toàn
  (stack hàng ngang, co width, clamp padding/gap/font), desktop giữ nguyên
- [x] AI component recommendation: gợi ý component tiếp theo theo mục tiêu +
  khoảng trống của bố cục, thêm một click hoặc thêm tất cả
- [x] AI Image-to-UI: tải ảnh chụp màn hình → dựng mockup có thể chỉnh sửa;
  dùng vision model khi có key, fallback phân tích cục bộ khi offline
- [x] AI URL-to-UI: nhập URL công khai → dựng lại bố cục chính; chặn SSRF
  (localhost/private IP), giới hạn dung lượng/thời gian, xử lý redirect an toàn
- [x] AI design reference: trích bảng màu chủ đạo từ ảnh mẫu, ánh xạ thành theme
  token (mode/primary/background/foreground/muted/border/radius/font), chỉnh tay
  trước khi áp dụng; PNG giải mã phía server, JPEG/WebP dùng canvas phía client
- [x] Multi-page: mỗi dự án nhiều trang (tạo/đổi tên/xoá/chuyển trang, slug duy
  nhất), mỗi trang có document và lịch sử phiên bản riêng; AI tạo 2–5 trang liên
  kết dùng chung theme/navbar, áp dụng nguyên tử qua `PUT /pages`; nhân bản dự án
  copy toàn bộ trang
- [x] Public/private sharing: tạo link xem trước toàn dự án (công khai hoặc có
  mật khẩu scrypt), thời hạn 1–365 ngày, copy/mở/thu hồi; viewer read-only
  `/share/:token` với chuyển trang và desktop/tablet/mobile; link hết hạn trả 410,
  link thu hồi 404
- [x] Commenting & review: thread gắn vào element đang chọn hoặc toàn trang,
  hội thoại nhiều lượt, đánh dấu resolved/mở lại, lọc open/resolved, chọn lại
  element trên canvas từ thread; API scoped theo project + page
- [x] Custom design systems: lưu bộ token (màu, font, radius, mode) đặt tên, tạo
  từ mockup đang mở, áp dụng cho mọi trang của project chỉ một click, chuyển đổi
  qua lại giữa các system, export/import token dạng JSON để chia sẻ team; xóa
  design system không làm hỏng project (link tự gỡ)
- [x] Component libraries: tạo thư viện dùng lại, lưu node đang chọn (hoặc
  subtree) thành component có loại/label/category/tags, chèn lại vào bất kỳ
  trang nào với id mới; export/import cả thư viện dạng JSON để chia sẻ giữa
  project/workspace; tên thư viện và loại component là duy nhất
- [x] Phân quyền theo vai trò (RBAC): owner > admin > editor > viewer; owner quản
  lý toàn bộ, admin thêm/xóa thành viên và đổi vai trò, editor sửa nội dung dự
  án, viewer chỉ đọc; mọi endpoint project-scoped đều kiểm tra quyền ở backend
  (viewer ghi → 403, non-member → 403, project không tồn tại → 404); identity
  chọn qua header `x-user-email` cho test, mặc định là demo user
- [x] Team collaboration: 2 user cùng mở project thấy presence real-time qua
  WebSocket (avatar/role, tự reconnect, xóa khi rời); lưu dùng optimistic
  concurrency (`baseVersion` = revision) — ghi đè từ phiên cũ bị từ chối 409
  thay vì mất dữ liệu, web hiện banner "Tải bản mới nhất"; mọi thay đổi document
  được broadcast tới các client đang mở
- [x] API / SDK: gói `@ai-mockup-studio/sdk` — typed client đầy đủ (project
  CRUD/duplicate, document get/save với optimistic concurrency, pages,
  versions, members), base URL + identity qua header, lỗi thành `MockupError`
  giữ status code; đã chạy E2E qua SDK thật
- [x] Responsive preview desktop/tablet/mobile + override style theo breakpoint
  (inspector & resize ghi vào `responsive.tablet/mobile`, desktop giữ nguyên)
- [x] Version history: snapshot tự động (throttle 5 phút), xem, so sánh và khôi phục
- [x] Quản lý dự án: tạo, đổi tên, nhân bản, xóa
- [x] Nhân bản trang (dự án mới) giữ schema + assets, URL ảnh được viết lại
- [x] Quản lý ảnh của dự án: upload (PNG/JPEG/WebP/GIF ≤ 2 MB), dùng/thay ảnh, xóa
- [x] Export PNG/SVG/JSON từ canvas
- [x] Export code HTML/React/Vue (style inline, nhúng ảnh dạng data URL, tải/copy)
- [x] Design-to-code: tách block cấp cao thành component React/Vue (hoặc HTML),
  sinh `styles.css` với class ngữ nghĩa + design token dạng CSS variable, xem và
  chỉnh sửa từng file trước khi copy/tải
- [x] Drizzle migration + seed; API E2E và UI flow đã kiểm chứng
- [x] Monitoring: `/api/health` (DB readiness), `/api/metrics` (latency, lỗi, AI token/fallback)
- [x] Production hardening: Redis rate limit chia sẻ giữa nhiều API instance
  (`REDIS_URL`, fallback an toàn về in-memory khi Redis mất)
- [x] AI evaluation: test set 8 prompt + 3 edit case, metric cấu trúc/intent/fallback
- [x] Performance: 601 node render/selection ổn định, guard test trong CI
- [x] CI workflow (build + typecheck + test + API smoke 192 check + AI eval với Postgres)
- [x] Runbook deploy production (env, migrate, systemd, Nginx, health, rollback)
- [ ] Deploy/rollback thực tế lên môi trường production (cần hạ tầng/host thật)

---

*Tài liệu gốc: [ChatGPT shared conversation](https://chatgpt.com/share/6af2d25b-0f84-83ec-aacf-8e60a35854ed)*
