# 07 — Feature Roadmap — Những tính năng cần có (+ Effort Estimation)

> Nguồn: mục #6 của hội thoại ChatGPT + phân tích mở rộng.
>
> 🕐 **Quy ước ước lượng (ideal hours):** mọi con số là **giờ tập trung** (excludes meeting, task switching, rảnh rỗi).
> Giả định team: **2 dev** (1 Frontend + 1 Backend) làm việc song song; hours là **tổng nỗ lực toàn team**.
> Nếu chỉ có **1 dev full-stack**, nhân tổng với hệ số ~1.2–1.4 (do chuyển ngữ cảnh FE/BE).
> **Ước lượng là dải số** (tối thiểu ↔ tối đa) vì độ phức tạp phụ thuộc loại model/component.

---

## Tổng quan: Effort theo Phase

| Phase | Tên | Ước lượng (ideal h) | Mục tiêu |
|-------|-----|--------------------:|----------|
| 1 | MVP (Must have) | **~230–290h** | Ra mắt luồng text → mockup → chỉnh sửa → lưu |
| 2 | Visual Design Experience | **~180–230h** | Editor thân thiện như công cụ design thật |
| 3 | Advanced AI | **~160–210h** | Khác biệt hóa bằng AI nâng cao |
| 4 | Enterprise / Developer | **~200–260h** | Bán cho team & developer |
| | **Tổng cộng** | **~770–990h** | *(≈ 4.5–6 tháng, 2 dev)* |

---

## Phase 1 — MVP (Must have)

Mục tiêu: người dùng tạo một trang dashboard, chỉnh sửa và lưu lại **mà không cần viết code**.

| # | Feature | Ước lượng | Task breakdown | Acceptance criteria |
|---|---------|----------:|----------------|---------------------|
| 1.1 | **Project management** (tạo, xóa, duplicate) | 8–12h | Tạo bảng `projects` + REST CRUD; UI danh sách/tạo/xóa/duplicate; xác nhận khi xóa | ✅ Tạo/xóa/dup project từ UI; dữ liệu lưu DB; duplicate ra bản mới độc lập |
| 1.2 | **Text-to-UI** (prompt → mockup) | 40–56h | AI orchestrator + validator; gọi LLM tạo schema; streaming trạng thái; xử lý lỗi/retry | ✅ Nhập prompt → hiện mockup trong ~≤30s; schema hợp lệ sau validator; retry khi JSON lỗi |
| 1.3 | **Component renderer** (JSON schema → UI) | 32–40h | Package `ui-renderer`; map schema node → component; hỗ trợ layout/basic; error boundary | ✅ Render đúng cây component từ schema; component thiếu prop không crash toàn bộ |
| 1.4 | **Basic design system** (color, typography, spacing) | 16–20h | Design tokens (theme, spacing, type scale); seed provider; áp vào renderer | ✅ Đổi token → render thay đổi; tokens chuẩn hóa dùng chung FE/BE |
| 1.5 | **Visual canvas** (preview giao diện) | 24–32h | Canvas area; scale/pan; hiện selection box; viewport desktop | ✅ Hiển thị mockup; chọn/thao tác element; kéo pan ổn định |
| 1.6 | **Component selection** | 8–10h | Click để chọn; highlight; Escape bỏ chọn; single-select | ✅ Click chọn/đổi chọn; outline đúng element; state selection riêng biệt |
| 1.7 | **Property inspector** (width, height, color, padding…) | 16–24h | Form phản chiếu props; cập nhật qua Command Manager; undo/redo cho từng thay đổi | ✅ Sửa prop → canvas cập nhật tức thì; thay đổi hoàn tác được |
| 1.8 | **AI editing** (chat để chỉnh UI) | 24–32h | AI patch generator; áp patch lên document; hiển thị status/lỗi | ✅ "Đổi sidebar rộng 300px" → patch & canvas đổi; patch không hợp lệ bị từ chối kèm thông báo |
| 1.9 | **Undo / Redo** | 12–16h | Command Manager; undo/redo stack; phím tắt Ctrl+Z/Y | ✅ Undo/redo đúng thứ tự; trạng thái sau undo nhất quán với document |
| 1.10 | **Save / Load** | 12–16h | Lưu document (JSONB); load project; autosave định kỳ | ✅ Lưu → đóng → mở lại đúng mockup; autosave không mất việc khi refresh |

**Ước lượng tổng Phase 1: 192–258h** *(thực tế chạm mốc ~230–290h khi tính tích hợp)*

---

## Phase 2 — Visual Design Experience (High priority)

| # | Feature | Ước lượng | Task breakdown | Acceptance criteria |
|---|---------|----------:|----------------|---------------------|
| 2.1 | **Drag & Drop components** | 24–32h | Palette component; kéo thả vào canvas; tính vị trí drop; tạo command `add` | ✅ Kéo từ palette → component xuất hiện đúng chỗ; hoàn tác được; tránh drop vào layout sai |
| 2.2 | **Resize elements** | 16–24h | Handle resize; ghost preview; ràng buộc min/max; commit khi thả | ✅ Kéo cạnh/góc → đổi size; không nhỏ hơn min; undo/redo được |
| 2.3 | **Multi-select** | 8–12h | Hold-click/Ctrl+click; drag-box select; action chung (move, delete) | ✅ Chọn nhiều cùng lúc; move/delete đồng loạt; visible highlight |
| 2.4 | **Copy / Paste** | 8–12h | Copy subtree schema; paste với ID mới; clipboard; paste vào layer khác | ✅ Copy/paste giữ nguyên prop; ID không trùng; có thể paste sang page khác |
| 2.5 | **Layers management** | 8–12h | Cây layers; rename; ẩn/hiện; khóa; reorder | ✅ Cây đồng bộ document; ẩn/hiện & khóa tác động canvas; reorder đổi thứ tự render |
| 2.6 | **Responsive breakpoints** | 16–24h | Breakpoints (desktop/tablet/mobile); chuyển viewport; responsive rules từ schema | ✅ Đổi breakpoint → layout điều chỉnh đúng rule; preview từng kích thước |
| 2.7 | **Design tokens** (full) | 12–16h | Quản lý token; sửa token → áp toàn cục; token inspector | ✅ Sửa token cập nhật mọi component dùng nó; lưu token với design-system |
| 2.8 | **Component library** | 16–24h | Danh mục component; search/filter; nhóm theo loại; preview mini | ✅ Tìm & kéo được component; hiển thị nhóm; component lấy từ registry thống nhất |
| 2.9 | **Import image / asset** | 8–12h | Upload asset; validate loại/kích thước; lưu object storage; dùng trong canvas | ✅ Upload → xuất hiện trong assets; dùng được trong canvas; file xấu bị chặn |
| 2.10 | **Version history** | 16–24h | Snapshot document; timeline versions; xem/restore bản cũ; diff cơ bản | ✅ Tự lưu snapshot mỗi lần thay đổi lớn; restore về bản cũ; so sánh giữa 2 bản |
| 2.11 | **Duplicate page** | 4–6h | Sao chép page + document → page mới | ✅ Duplicate tạo page độc lập, giữ schema & assets tham chiếu |
| 2.12 | **Export PNG / SVG** | 12–16h | Render canvas ra PNG; export SVG; tải file | ✅ Xuất PNG đúng kích thước; SVG giữ cấu trúc; tải về được |

**Ước lượng tổng Phase 2: 148–212h** *(nếu làm song song nhóm 2 dev, tuần hoàn thiện hơn)*

---

## Phase 3 — Advanced AI (AI capabilities)

| # | Feature | Ước lượng | Task breakdown | Acceptance criteria |
|---|---------|----------:|----------------|---------------------|
| 3.1 | **Image-to-UI** (upload screenshot → recreate UI) | 32–40h | Upload ảnh → gửi vision model; phân tích layout → schema; validate & render | ✅ Upload màn hình → ra mockup gần giống (bố cục/component); có fallback khi model thiếu vision |
| 3.2 | **URL-to-UI** (analyze website → recreate) | 24–32h | Fetch URL (an toàn SSRF); trích nội dung/ảnh; chuyển thành schema; giới hạn scope | ✅ Nhập URL → dựng lại bố cục chính; chặn URL nội bộ/nội dung lớn; xử lý thiếu JS |
| 3.3 | **Design reference** (upload design image) | 16–24h | Nhận ảnh mẫu; trích style (màu/font/spacing); áp làm design tokens | ✅ Ảnh mẫu → tách được bảng màu & áp vào mockup; cho phép điều chỉnh thủ công |
| 3.4 | **Multi-page generation** | 16–24h | Prompt → nhiều page; sinh routing/nav; đồng bộ design token giữa trang | ✅ 1 prompt tạo được nhiều trang; điều hướng giữa trang hoạt động; token dùng chung |
| 3.5 | **AI design critique** | 12–16h | Gửi schema hiện tại cho AI phân tích; trả lời đánh giá + gợi ý | ✅ Đưa ra nhận xét về contrast/spacing/hierarchy; gợi ý hành động cụ thể |
| 3.6 | **Accessibility analysis** | 12–16h | Kiểm tra contrast, thiếu label, size chữ; báo cáo + đề xuất sửa | ✅ Chỉ ra lỗi a11y (theo list rule); nút "auto-fix" áp dụng được command |
| 3.7 | **AI-generated dummy data** | 8–10h | Sinh dữ liệu giả cho table/card/form theo context | ✅ Điền dummy data phù hợp; cho phép dùng lại/đổi dữ liệu; không lộn loại dữ liệu |
| 3.8 | **AI responsive optimization** | 12–16h | Phân tích schema → gợi ý/quy tắc responsive cho từng component | ✅ Tự đề xuất breakpoint rule; áp dụng được; không phá vỡ bố cục gốc |
| 3.9 | **AI component recommendation** | 8–10h | Gợi ý component phù hợp ngữ cảnh (stat, form, chart…) | ✅ Gợi ý đúng loại theo dữ liệu/nội dung; chọn là thêm ngay |
| 3.10 | **AI design consistency check** | 10–14h | Rà soát token/spacing/type trên document; cảnh báo lệch chuẩn | ✅ Liệt kê điểm lệch chuẩn; một-click sửa theo design system |

**Ước lượng tổng Phase 3: 150–202h** *(độ lớn thực tế phụ thuộc model vision/reasoning bạn chọn)*

---

## Phase 4 — Enterprise / Developer Experience

| # | Feature | Ước lượng | Task breakdown | Acceptance criteria |
|---|---------|----------:|----------------|---------------------|
| 4.1 | **Export React / Vue / HTML** | 32–40h | Schema → code generator; template các component; map design token → CSS | ✅ Export ra code chạy được (dev server); component map đủ; HTML đơn giản hơn |
| 4.2 | **Design-to-code** | 24–32h | Từ mockup/schema → component code chuẩn; editable output; xử lý nesting | ✅ Sinh code component tương đương schema; output dễ đọc & đúng chuẩn framework |
| 4.3 | **Shared component libraries** | 16–24h | Package component library; publish/import; version component | ✅ Chia sẻ thư viện giữa project; import lại được; version rõ ràng |
| 4.4 | **Team collaboration** | 24–32h | Invite member; online presence; gộp chỉnh sửa cơ bản; socket | ✅ 2 user cùng mở project; thấy presence; ko ghi đè mất dữ liệu |
| 4.5 | **Role-based access control** | 12–16h | Roles (owner/admin/editor/viewer); gán user; enforce ở API | ✅ Phân quyền đúng; viewer không sửa được; auth guard trên backend |
| 4.6 | **Commenting and review** | 12–16h | Comment trên canvas/component; thread; resolve | ✅ Comment gắn vào element; thread hội thoại; trạng thái resolved |
| 4.7 | **Public/private sharing** | 8–12h | Share link công khai/riêng tư; access token; hết hạn | ✅ Preview link chia sẻ được; đúng quyền public/private; revoke được |
| 4.8 | **Custom design systems** | 12–16h | Tạo DS riêng; import/export token; gán vào project | ✅ Tạo & áp DS tùy chỉnh; xuất/nhập token JSON; chuyển project giữa DS |
| 4.9 | **API / SDK** | 24–32h | REST API public; SDK (create/update/read schema); docs/auth key | ✅ Gọi API tạo/đọc project; tài liệu; API key hoạt động |
| 4.10 | **Plugin ecosystem** | 32–48h | Plugin manifest; sandbox runtime; API cho plugin; marketplace tối giản | ✅ Plugin tải & chạy sandbox; truy cập API giới hạn; không phá document |
| 4.11 | **Organization workspace** | 12–16h | Tổ chức org, member, project thuộc org | ✅ Quản lý org & member; project thuộc đúng org; role theo org |

**Ước lượng tổng Phase 4: 208–300h** *(plugin & collaboration là 2 mục tốn công nhất)*

---

## 💡 Phân tích & mở rộng

### Ước lượng rút gọn theo phase (ideal hours, 2 dev)

| Phase | Nội dung | Min | Max |
|-------|----------|----:|----:|
| 1 | MVP | 192 | 258 |
| 2 | Visual Design | 148 | 212 |
| 3 | Advanced AI | 150 | 202 |
| 4 | Enterprise/Dev | 208 | 300 |
| | **Tổng** | **698** | **972** |

> ⚠️ Cộng thêm overhead (setup CI, bugfix, review, nghiên cứu) ~20–30% → **tổng thực tế ~850–1260h**.

### Ghi chú phụ thuộc giữa các tính năng

- **Design tokens** (P2, 2.7) phải thiết kế tương thích **UI Schema** ở MVP để không refactor.
- **Version history** (P2, 2.10) dựa trên **Command Manager** từ P1 (mục 1.7/1.9).
- **Export code** (P4, 4.1) phụ thuộc schema → component mapping chuẩn từ P1.
- **Collab** (P4, 4.4) nên đợi sau **RBAC** (4.5) hoặc làm trước tuỳ nhu cầu.

### Câu hỏi để tinh chỉnh ước lượng

1. Team size thực tế? (1 dev full-stack → nhân hệ số 1.2–1.4; 2 dev → giữ nguyên).
2. Kinh nghiệm AI/LLM của team? (Mới → cộng buffer 20% cho mục AI).
3. Có cần bám scope cố định hay được phép cắt giảm tính năng để giữ deadline?



