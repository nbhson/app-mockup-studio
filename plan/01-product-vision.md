# 01 — Product Vision — Ứng dụng sẽ làm gì?

> Nguồn: mục #1 của hội thoại ChatGPT + phân tích mở rộng.

---

## Tổng quan

**AI Mockup Studio** là một **AI-native visual design platform** cho phép người dùng:

1. **Generate UI** — Text-to-UI generation: mô tả giao diện bằng ngôn ngữ tự nhiên, AI tạo ra mockup.
2. **Visual Editor** — Chỉnh sửa và tùy biến giao diện trực quan.
3. **AI Assistant** — Chỉnh sửa qua hội thoại (conversational editing).
4. **Responsive Preview** — Xem trước trên desktop, tablet, mobile.

### Conceptual product experience

```
AI Mockup Studio
├── Generate UI          → Text-to-UI generation
├── Visual Editor        → Edit and customize
├── AI Assistant         → Conversational editing
└── Responsive Preview   → Desktop, tablet, mobile
```

---

## Ví dụ luồng sử dụng người dùng (Example user workflow)

1. "Create an enterprise dashboard for managing employees."
2. AI tạo layout, components, colors và typography.
3. Người dùng chọn một component và yêu cầu AI sửa đổi nó.
4. Người dùng điều chỉnh thủ công các thuộc tính thông qua inspector.
5. Preview các layout responsive.
6. Export React/Vue/HTML hoặc chia sẻ preview link.

---

## 3 nhóm đầu ra (xác định ngay từ đầu)

| Nhóm | Mô tả |
|------|-------|
| **Mockup** | Giao diện trực quan để đánh giá ý tưởng. |
| **Prototype** | Giao diện có tương tác, navigation và dữ liệu giả lập. |
| **Code** | Source code có cấu trúc, có thể tiếp tục phát triển. |

> ⚠️ **Lưu ý quan trọng:** Đừng cố giải quyết cả ba ở mức hoàn thiện ngay từ MVP.

---

## Nguyên tắc kiến trúc sản phẩm cốt lõi

Không xây dựng app như một **chatbot sinh HTML/CSS**. Thay vào đó, thiết kế như một **AI-native visual design platform**, trong đó:

| Vai trò | Thành phần |
|---------|-----------|
| 🧠 **Bộ não** | AI — phân tích yêu cầu, sinh giao diện, sửa theo hội thoại |
| 🏗️ **Nền tảng** | Rendering engine, component engine, design system — đảm bảo chất lượng đầu ra |

### Vì sao AI không sinh code tùy ý?

AI **không nên trực tiếp sinh và thực thi code tùy ý trong canvas**. Thay vào đó, AI sinh ra **cấu trúc dữ liệu UI có schema xác định** (JSON UI Schema), và **renderer của ứng dụng** chịu trách nhiệm hiển thị cấu trúc đó.

Lợi ích của cách tiếp cận schema-driven:

- ✅ Kiểm soát được component được sinh ra.
- ✅ Dễ chỉnh sửa từng thành phần.
- ✅ Hỗ trợ Undo/Redo.
- ✅ Lưu version và compare.
- ✅ Tránh việc AI sinh code không an toàn.
- ✅ Dễ dàng chuyển đổi sang nhiều framework.

---

## Ưu tiên 3 thành phần theo thứ tự (quan điểm cuối cùng)

| Thứ tự | Thành phần | Vai trò |
|--------|-----------|---------|
| 1 | **UI Schema Engine** | Nền tảng dữ liệu của toàn bộ sản phẩm. |
| 2 | **Visual Rendering & Editing Engine** | Biến schema thành giao diện có thể chỉnh sửa. |
| 3 | **AI Orchestration Engine** | Giúp người dùng tạo và chỉnh sửa giao diện bằng ngôn ngữ tự nhiên. |

> Ba thành phần này phải **được thiết kế độc lập nhưng phối hợp chặt chẽ**.

---

## 💡 Phân tích & mở rộng

- **Điểm mấu chốt để MVP thành công:** ưu tiên *một luồng trải nghiệm hoàn chỉnh* (text → mockup → chỉnh sửa → lưu) thay vì làm dài nhiều tính năng.
- **Schema-driven là "moat" của sản phẩm:** nếu thiết kế schema tốt, các tính năng AI nâng cao (image-to-UI, URL-to-UI, responsive optimization...) sau này đều trở nên dễ dàng hơn nhiều.
- **Định vị thị trường:** không cạnh tranh trực tiếp "thay thế Figma ngay lập tức", mà tập trung vào khoảng trống *AI sinh giao diện nhanh từ ý tưởng*.

### Câu hỏi cần làm rõ khi bắt đầu

1. Đối tượng người dùng chính là ai? (designer, developer, founder, non-technical?)
2. Output tối quan trọng trong MVP là gì — Mockup hay Code?
3. Sản phẩm hướng tới single-player hay collaboration từ đầu?
