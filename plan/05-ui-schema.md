# 05 — UI Schema — Trái tim của ứng dụng

> Nguồn: mục #4.1 của hội thoại ChatGPT + phân tích mở rộng.

---

## Vai trò

**UI Schema** là ngôn ngữ chung giữa AI và hệ thống rendering:

- **AI sinh ra** cấu trúc dữ liệu UI (JSON) theo schema.
- **Renderer** đọc schema và render thành giao diện có thể chỉnh sửa.
- **Mọi chỉnh sửa** (cả bằng AI và bằng tay) đều đi qua schema.

---

## Ví dụ schema AI trả về

```json
{
  "type": "page",
  "id": "crm-dashboard",
  "name": "CRM Dashboard",
  "viewport": {
    "width": 1440,
    "height": 900
  },
  "theme": {
    "mode": "light",
    "primary": "#2563EB",
    "fontFamily": "Inter"
  },
  "children": [
    {
      "type": "layout.sidebar",
      "id": "main-sidebar",
      "props": {
        "width": 260,
        "collapsible": true
      }
    },
    {
      "type": "layout.container",
      "id": "main-content",
      "children": [
        {
          "type": "dashboard.header",
          "id": "header",
          "props": {
            "title": "Sales Overview"
          }
        },
        {
          "type": "dashboard.stats",
          "id": "stats",
          "props": {
            "columns": 4
          }
        }
      ]
    }
  ]
}
```

> Ví dụ này **chỉ mang tính minh họa**. Schema thực tế cần quy định đầy đủ:
> - Component definitions
> - Constraints (ràng buộc)
> - Styles
> - Responsive behavior
> - Data bindings

---

## Vì sao cần schema riêng?

### Ví dụ: cập nhật nhỏ nhanh chóng

Người dùng yêu cầu: *"Change the sidebar width to 300px."*

AI chỉ cần tạo một **patch**:

```json
{
  "operation": "update",
  "targetId": "main-sidebar",
  "changes": {
    "props.width": 300
  }
}
```

- **Renderer** nhận patch và cập nhật component.
- **Không cần sinh lại toàn bộ trang.**
- Đây là một trong những quyết định sẽ **ảnh hưởng lớn đến khả năng mở rộng** của sản phẩm.

---

## 💡 Phân tích & mở rộng

### Các khối cấu trúc nên có trong schema thực tế

```json
{
  "type": "page",
  "id": "…",
  "name": "…",
  "viewport": { "width": 1440, "height": 900 },
  "theme": {
    "mode": "light",
    "primary": "#2563EB",
    "fontFamily": "Inter"
  },
  "children": [
    {
      "type": "layout.sidebar",
      "id": "main-sidebar",
      "props": { "width": 260, "collapsible": true }
    }
  ]
}
```

| Khía cạnh | Cần quy định |
|-----------|--------------|
| **Component definitions** | Danh sách component có sẵn, props của từng loại |
| **Constraints** | Ràng buộc (vd: width > 0, children chỉ chấp nhận layout.* + component.*) |
| **Styles** | Hệ thống style (token reference hoặc raw value) |
| **Responsive behavior** | Breakpoints, layout rules theo viewport |
| **Data bindings** | Gắn dữ liệu giả lập, binding từ state |

### Các nhóm type component đề xuất

- `layout.*` — sidebar, container, section, navbar, grid…
- `dashboard.*` — header, stats, chart, table…
- `basic.*` — button, input, text, image…
- `formal.*` — form, card, modal…

### Đề xuất phân loại patch operations

| Operation | Mô tả | Ví dụ |
|-----------|-------|-------|
| `add` | Thêm component mới | thêm button |
| `update` | Sửa props của component | đổi width |
| `remove` | Xóa component | xóa chart |
| `move` | Di chuyển / đổi thứ tự | di chuyển card lên trên |
| `replace` | Thay component này bằng component khác | thay bar chart bằng line chart |
| `style` | Cập nhật style riêng | đổi màu primary |

### Gợi ý validation nguyên tắc (cho tuơng lai)

1. Mọi thay đổi document — từ AI lẫn từ tay — phải qua **Command Manager** thống nhất.
2. Schema versioning: thêm `schemaVersion` vào document để quản lý migration.
3. Stability: component có **ID ổn định** (stable component IDs) để patch, reference và version diff không hỏng.
