# 12 — Implementation Roadmap (Lộ trình triển khai) + Effort Estimation

> Nguồn: mục #11 của hội thoại ChatGPT + phân tích mở rộng.
>
> 🕐 **Quy ước ước lượng (ideal hours):** giờ tập trung, đội **2 dev** (1 FE + 1 BE).
> Mỗi task có dải **min–max**; giai đoạn AI cộng buffer nếu team mới về LLM.

---

## Tóm tắt effort theo 6 giai đoạn

| Giai đoạn | Nội dung | Ước lượng | Milestone |
|-----------|----------|----------:|-----------|
| 1 | Foundation & Architecture | 60–90h | Schema & monorepo chạy được |
| 2 | Rendering Engine | 80–110h | Canvas render schema tĩnh |
| 3 | Editor Engine | 70–100h | **Editor chạy được không cần AI** |
| 4 | AI Integration | 100–140h | **MVP hoàn chỉnh** |
| 5 | Product Features | 50–80h | Soft-launch |
| 6 | Production Readiness | 40–70h | Sẵn sàng production |
| | **Tổng** | **400–590h** | *(≈ 2.5–3.7 tháng cho 2 dev)* |

> Lưu ý: Tổng 6 giai đoạn này ≈ tập con kỹ thuật của Feature Roadmap (07). Xem sự tương ứng ở bảng cuối file.

---

## Giai đoạn 1 — Foundation & Architecture (60–90h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 1.1 | Setup **monorepo** (pnpm + Turborepo) | 8–12h | Cấu hình workspace, packages, shared configs, scripts | ✅ `pnpm install` chạy được; workspace packages resolve; build turbo ổn |
| 1.2 | Define **UI Schema** (v0.1) | 16–24h | Types cho page/component/patch/viewport/theme; versioning | ✅ Types tương ứng trong `ui-schema`; có ví dụ hợp lệ & test parse |
| 1.3 | Define **Component Registry** | 12–16h | Danh sách component và props ban đầu; phân nhóm layout/basic/dashboard | ✅ Registry export danh sách; validation component-type khớp registry |
| 1.4 | Define **Design Tokens** | 8–12h | Color/typography/spacing/radius/shadow seed | ✅ Token xuất JSON dùng chung; renderer đọc được token |
| 1.5 | Setup **database** (migrations đầu tiên) | 12–20h | PostgreSQL + Prisma/Drizzle; bảng users/projects/pages/documents | ✅ Migration chạy; seed user/project; connection từ NestJS |
| 1.6 | Setup **CI/CD + linters sơ bộ** | 4–6h | GitHub Actions; lint/typecheck build | ✅ Push → CI chạy lint+build; report pass |

---

## Giai đoạn 2 — Rendering Engine (80–110h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 2.1 | Build **component renderer** | 24–32h | Package `ui-renderer`: schema node → component; token binding | ✅ Render đúng cây từ schema; prop thiếu không crash; token áp đúng |
| 2.2 | Build **component tree** | 12–16h | Cây component trong bộ nhớ; parents/children; lookup by ID | ✅ Duyệt cây, tìm theo ID; thêm/xóa cập nhật cây |
| 2.3 | Build **canvas** | 16–24h | Vùng canvas, render document, scale/pan, viewport desktop | ✅ Hiển thị mockup; pan/zoom mượt cơ bản; re-render khi document đổi |
| 2.4 | Build **selection mechanism** | 8–12h | Click chọn, highlight, Escape bỏ chọn; Editor State riêng | ✅ Chọn/đổi chọn chuẩn; không đụng vào Document State |
| 2.5 | Build **properties inspector** | 12–20h | Đọc props của selection; hiện form; cập nhật qua command | ✅ Sửa prop → canvas cập nhật; reset form đúng khi đổi selection |
| 2.6 | **Render tests** (unit + snapshot) | 8–14h | Test render các schema mẫu | ✅ Bộ test render mẫu pass; snapshot kiểm soát hồi quy |

---

## Giai đoạn 3 — Editor Engine (70–100h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 3.1 | **Command Manager** | 12–16h | apply/revert cho add/remove/update/move/updateStyle | ✅ Mọi mutation đi qua command; mỗi command revert được |
| 3.2 | **Undo / Redo** | 8–12h | Undo/redo stack, ngắn mạch khi có thay đổi mới | ✅ Ctrl+Z/Y đúng thứ tự; trạng thái sau undo nhất quán |
| 3.3 | **Drag & Drop** | 12–16h | Trên canvas + từ palette; tính vị trí drop; command `add`/`move` | ✅ Kéo tạo/sửa vị trí; drop chính xác; undo/redo được |
| 3.4 | **Resize** | 8–12h | Handle resize, ghost preview, ràng buộc min | ✅ Resize đúng khi kéo; không < min; commit khi thả |
| 3.5 | **Document persistence** | 12–16h | Lưu/load document JSONB; autosave định kỳ; load project | ✅ Lưu → load lại nguyên vẹn; autosave không mất việc |
| 3.6 | **Editor State + kết nối UI** | 10–16h | Pinia stores: document/editor/ai; module workspace wiring | ✅ 3 state tách biệt; UI phản hồi đúng theo state |

---

## Giai đoạn 4 — AI Integration (100–140h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 4.1 | **AI Provider abstraction + Model Router** | 16–24h | Interface provider; adapter OpenAI/Anthropic/OpenAI-compatible; router theo task | ✅ Thêm provider qua config; router chọn đúng model theo task; không hardcode |
| 4.2 | **Prompt Engineering** (`ai-prompts`) | 12–16h | Prompt template cho generation/editing/analysis; context builder | ✅ Prompt ổn định; thay đổi template không đụng code logic |
| 4.3 | **Requirement Analyzer** | 12–16h | Trích intent/page type/features/constraints (structured output) | ✅ Trả về cấu trúc intent đúng; sai giới hạn → fallback xử lý |
| 4.4 | **UI Schema Generator** | 16–24h | LLM → JSON schema hợp lệ; streaming; retry | ✅ Sinh schema thỏa validator; retry ≤ 2 khi JSON lỗi |
| 4.5 | **Schema Validator** | 8–12h | Validate component types, refs, layout rules | ✅ Chặn component/ID không tồn tại; trả lỗi rõ ràng |
| 4.6 | **AI Patch Generator + apply** | 16–24h | Patch từ yêu cầu chỉnh sửa; áp qua Command Manager | ✅ "Đổi sidebar 300px" → patch & canvas đổi; patch sai bị từ chối |
| 4.7 | **AI chat UI integration** | 12–16h | Giao diện assistant; status; lịch sử; chọn component trước khi hỏi | ✅ Chat gọi được AI; hiện trạng thái; hỏi theo component đang chọn |

---

## Giai đoạn 5 — Product Features (50–80h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 5.1 | **Project management** | 8–12h | CRUD/duplicate project; UI quản lý | ✅ Tạo/xóa/dup từ UI; lưu DB |
| 5.2 | **Version history** | 12–16h | Snapshot document; timeline; restore | ✅ Tự snapshot khi thay đổi lớn; restore về bản cũ |
| 5.3 | **Responsive preview** | 12–16h | Breakpoints; chuyển viewport; preview | ✅ Xem desktop/tablet/mobile; layout đổi đúng rule |
| 5.4 | **Asset management** | 8–12h | Upload/list/use assets; validate | ✅ Upload & dùng trong canvas; file sai bị chặn |
| 5.5 | **Export** (PNG/SVG) | 8–12h | Render canvas → PNG/SVG; tải file | ✅ Xuất PNG/SVG đúng; tải được |

---

## Giai đoạn 6 — Production Readiness (40–70h)

| # | Task | Ước lượng | Mô tả | Acceptance criteria / DoD |
|---|------|----------:|-------|---------------------------|
| 6.1 | **Security testing** | 10–16h | Sanitize AI output; bảo vệ API keys; SSRF; rate limit; XSS | ✅ Không chạy JS từ AI; key mã hóa & không lộ; chặn SSRF; audit pass |
| 6.2 | **Performance testing** | 8–12h | Benchmark canvas nhiều elements; optimize | ✅ >500 elements render ổn; không lag khi thao tác |
| 6.3 | **AI evaluation** | 8–12h | Đánh giá chất lượng generation; dataset mẫu; đăng ký metric | ✅ Có test set + metric (schema hợp lệ, độ khớp ý) |
| 6.4 | **Monitoring** | 6–10h | Log, metrics (errors, latency, token usage), alert | ✅ Dashboard thấy request/lỗi/latency; alert khi quá ngưỡng |
| 6.5 | **CI/CD + deployment** | 8–12h | Deploy web+api; migrate; rollback; env | ✅ Deploy tự động; rollback được; config theo môi trường |

---

## 💡 Phân tích & mở rộng

### Lộ trình chi tiết hơn (kỹ thuật)

| Giai đoạn | Deliverable khả dụng | Thời điểm đánh giá |
|-----------|----------------------|--------------------|
| 1 | Monorepo chạy được, DB migration đầu tiên, schema types | Chốt schema trước khi viết renderer |
| 2 | Canvas hiển thị schema tĩnh (chưa cần AI) | Kiểm tra render correctness |
| 3 | Canvas chỉnh sửa bằng tay + undo/redo | **Milestone: editor chạy được không cần AI** |
| 4 | Prompt → schema → validate → render; AI patch | **Milestone: MVP hoàn chỉnh** |
| 5 | Project, version, preview, export | Bắt đầu soft-launch |
| 6 | Hardening, monitoring, CI/CD | Sẵn sàng production |

### Lưu ý quan trọng

- Giai đoạn 1–3 **song song một phần** được (schema & renderer đi cùng nhau).
- **AI Integration (GĐ 4)** chỉ bắt đầu sau khi **UI Schema ổn định** — tránh sửa prompt/validator liên tục.
- Nên chạy **vertical slice** trước (1 prompt cố định → 1 dashboard → render → chỉnh sửa) để validate kiến trúc (spike).
- Buffer: cộng thêm **~20–30% overhead** (bugfix, review, nghiên cứu) → tổng thực tế **~500–770h**.

### Liên kết: 6 giai đoạn ← → Feature Roadmap (07)

| Implementation (12) | Feature Roadmap (07) |
|---------------------|----------------------|
| GĐ 1 Foundation | Nền cho toàn bộ Phase 1 |
| GĐ 2 Rendering | 1.3, 1.4, 1.5, 1.6 |
| GĐ 3 Editor | 1.5, 1.6, 1.7, 1.9 + một phần 2.1/2.2 |
| GĐ 4 AI | 1.2, 1.8 (+ Phase 3 khi mở rộng) |
| GĐ 5 Product | 1.1, 1.10 + 2.6, 2.10, 2.12 |
| GĐ 6 Production | Xuyên suốt tất cả phase |
