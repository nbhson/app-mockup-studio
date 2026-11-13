# 06 — Frontend Workspace Structure

> Nguồn: mục #5 của hội thoại ChatGPT + phân tích mở rộng.

---

## Bố cục editor — 4 khu vực chính

Giao diện editor đề xuất gồm 4 khu vực:

```text
┌─────────────────────────────────────────────────────────────┐
│  AI Mockup Studio                    (Desktop) (Preview)    │
├───────────┬──────────────────────────────────┬───────────────┤
│  Layers   │           Canvas                 │  Properties   │
│  ─────────│──────────────────────────────────│──────────────│
│  Page     │      Sales Dashboard             │  Width: 300px │
│  ├ Header │      ## 2,450   Customers        │  Height: Auto │
│  ├ Sidebar│      ## $45K    Revenue          │  Padding: 16px│
│  └ Content│      Analytics chart             │  Color: Primary
│           │                                  │               │
│           │                                  │               │
├───────────┴──────────────────────────────────┴───────────────┤
│  AI Assistant                                               │
│  "Make the dashboard more modern and improve the spacing…"  │
└─────────────────────────────────────────────────────────────┘
```

**Ý tưởng:** Contceptual layout = **Layers + Canvas + Properties + AI Assistant**.

### Trách nhiệm từng khu vực

| Area | Vị trí | Responsibilities |
|------|--------|------------------|
| **Left panel** | Trái | Layers, component tree, assets |
| **Center** | Giữa | Canvas, selection, drag-and-drop |
| **Right panel** | Phải | Properties, styles, layout |
| **Bottom / floating panel** | Dưới / nổi | AI chat, prompts, generation history |

---

## Nguyên tắc thiết kế quan trọng

> ⚠️ **Canvas cần hoạt động độc lập với AI.**

Người dùng phải có thể **chỉnh sửa UI bằng thao tác trực tiếp** (drag, chọn, sửa property) ngay cả khi **AI không hoạt động** (offline, lỗi, không cấu hình AI).

---

## 💡 Phân tích & mở rộng

### Đề xuất hiện thực hóa (ứng với tech stack)

| Khu vực | Công nghệ/Ví dụ |
|---------|----------------|
| Layers | Module `layers/` — cây component từ document state |
| Canvas | Module `canvas/` — là trung tâm rendering + interact.js cho drag/resize |
| Inspector | Module `inspector/` — form phản chiếu props của component đang chọn |
| AI Assistant | Module `ai-assistant/` — chat + generation status + history |

### Những trải nghiệm cần có khi hiện thực hóa

1. **Component selection** — click để chọn, nhấn Escape để bỏ chọn.
2. **Property inspector** — thay đổi thuộc tính cập nhật ngay vào document state.
3. **Layers panel** — hỗ trợ đổi tên, ẩn/hiện, khóa (lock), sắp xếp lại thứ tự.
4. **AI Assistant** — có thể chọn component trước rồi yêu cầu AI chỉnh trên component đó.
5. **Generation history** — lưu lịch sử các lần tạo/sửa để quay lại bất kỳ trạng thái nào.

### Liên kết tài liệu

- Trạng thái editor chạy độc lập với document → xem [09-architecture-considerations.md](./09-architecture-considerations.md) mục 8.2.
- Cấu trúc module frontend → xem [08-project-structure.md](./08-project-structure.md).
