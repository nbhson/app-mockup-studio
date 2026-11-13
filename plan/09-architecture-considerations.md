# 09 — Những vấn đề kiến trúc cần giải quyết từ sớm

> Nguồn: mục #8 của hội thoại ChatGPT + phân tích mở rộng.

---

## 8.1. Canvas rendering performance

Canvas có thể chứa **hàng trăm hoặc hàng nghìn elements**. Cần tính đến:

- **Virtualization** khi có nhiều components.
- **Component-level rendering** (chỉ render component thay đổi).
- **Stable component IDs**.
- **Selective updates** thay vì render lại toàn bộ document.
- **Debounce property updates**.
- **Tách editor state và document state**.
- **Lazy-load** các component nặng như charts.

> ⚠️ Đặc biệt: **không nên** để mỗi lần người dùng kéo một element là phải gọi AI, hoặc cập nhật toàn bộ document lên server.

---

## 8.2. Document state management

Phân biệt rõ **3 loại state**:

| State | Ví dụ |
|-------|-------|
| **Document State** | UI tree, component properties |
| **Editor State** | Selected element, zoom, active tool |
| **AI State** | Prompt, generation status, conversation |

### Nguyên tắc

- **AI không nên trực tiếp mutate toàn bộ editor state.**
- Mọi thay đổi document nên thông qua một **cơ chế command/patch thống nhất**.

### Ví dụ cơ chế Command Manager

```text
Document
   |
   v
Command Manager
   |
   +-- AddComponent
   +-- RemoveComponent
   +-- UpdateProperties
   +-- MoveComponent
   +-- UpdateStyles
   |
   v
Document State
   |
   +-- Undo
   +-- Redo
   +-- Version History
```

---

## 8.3. AI reliability (Độ tin cậy của AI)

**LLM có thể:**
- Sinh JSON không hợp lệ.
- Sử dụng component không tồn tại.
- Tham chiếu element ID không tồn tại.
- Tạo layout không hợp lý.
- Lặp lại component.
- Thay đổi ngoài phạm vi yêu cầu.

**Vì vậy cần có:**
1. Schema validation.
2. Component registry.
3. Reference validation.
4. Patch validation.
5. Retry strategy.
6. Rollback.
7. Generation evaluation.

> ⚠️ **Không nên mặc định AI sinh ra kết quả đúng chỉ vì response trả về HTTP 200.**

---

## 8.4. Security (Bảo mật)

Sản phẩm nhận input từ người dùng và AI-generated content, nên cần:

- ✅ Không thực thi JavaScript tùy ý từ AI.
- ✅ Không dùng `eval()` để render component.
- ✅ Không cho phép HTML tùy ý nếu chưa sanitize.
- ✅ Validate URL và external assets.
- ✅ Kiểm soát SVG uploads.
- ✅ Rate limit AI requests.
- ✅ Quản lý API keys ở backend.
- ✅ Cô lập code execution nếu sau này có tính năng preview source code.

---

## 💡 Phân tích & mở rộng

### Bổ sung chi tiết cho từng vấn đề

#### Canvas performance — chiến thuật hiện thực

| Kỹ thuật | Cách làm |
|----------|----------|
| Virtualization | Chỉ render phần elements đang ở trong viewport (vd: sử dụng kỹ thuật windowing). |
| Selective updates | Theo dõi phụ thuộc (Vue reactivity / Pinia) để chỉ render component bị thay đổi. |
| Debounce | Đối với input liên tục (vd: kéo resize) — debounce việc flush lên server & commit command. |
| Lazy-load | Charts, images nặng → dynamic import khi vào viewport. |

#### Command Manager — đề xuất chuẩn hóa

- Mỗi command implement `{ apply(state): state; revert(state): state }` để có Undo/Redo dễ dàng.
- Patch từ AI cũng phải được **chuyển đổi thành command** để đồng nhất với thao tác bằng tay.
- Version history = store snapshot của document sau mỗi command (hoặc diff thay vì full snapshot để tiết kiệm dung lượng).

#### AI reliability — thiết kế retry/rollback

```mermaid
flowchart LR
    A[AI trả về schema/patch] --> B{Validation hợp lệ?}
    B -- Không hợp lệ --> C[Retry (có số lần giới hạn)]
    C --> A
    B -- Hợp lệ --> D[Áp dụng vào document]
    D --> E[Đánh giá kết quả]
    E -. không đạt ý .-> F[Rollback về snapshot trước đó]
```

- Giới hạn số lần retry (vd: 1–2 lần) để tránh chi phí & vòng lặp vô hạn.
- Luôn lưu snapshot trước khi áp dụng một generation lớn → rollback an toàn.

#### Security — lưu ý trọng tâm

- **Sanitize mọi nội dung AI sinh ra** trước khi đưa vào canvas (tránh XSS/HTML injection).
- **SVG** nên được "làm sạch" (remove scripts/event handlers) khi upload.
- **API keys** chỉ nằm ở backend, mã hóa khi lưu — chi tiết tại [14-custom-ai-provider.md](./14-custom-ai-provider.md).
- Rate limit dựa trên user/token để chống lạm dụng AI.
