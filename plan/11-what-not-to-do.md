# 11 — Những thứ KHÔNG nên làm ngay

> Nguồn: mục #10 của hội thoại ChatGPT + phân tích mở rộng.

---

## Danh sách tránh

| Không nên | Lý do |
|-----------|-------|
| **Multi-agent architecture** | Tăng complexity không cần thiết |
| **Microservices** | MVP chưa cần |
| **Real-time collaboration** | Khó đồng bộ document |
| **Full Figma replacement** | Scope quá lớn |
| **Generate arbitrary React/Vue code** | Khó kiểm soát và chỉnh sửa |
| **Tự xây image generation model** | Không phải core competency |
| **Hỗ trợ mọi UI framework** | Tăng đáng kể độ phức tạp |
| **Plugin marketplace** | Chưa có nhu cầu ban đầu |

---

## Lưu ý đặc biệt về Multi-Agent

> ⚠️ Đừng vội xây dựng hệ thống **Multi-Agent** gồm Planner, Designer, Coder, Reviewer, Optimizer ngay từ đầu.

- Một **AI orchestration service** với các bước tuần tự và **structured output** là **đủ cho MVP**.
- Chỉ khi quy mô và độ phức tạp yêu cầu mới nâng cấp lên multi-agent.

---

## 💡 Phân tích & mở rộng

### Nguyên tắc chung

1. **MVP-first:** Mọi quyết định "thêm" đều phải đi qua câu hỏi *"nó có cần để hoàn thiện luồng MVP không?"*.
2. **YAGNI (You Aren't Gonna Need It):** các tính năng như plugin, collaboration, multi-framework nên đợi tới khi có nhu cầu thực từ người dùng.
3. **Ưu tiên độ sâu hơn độ rộng:** một luồng hoàn chỉnh tốt hơn mười tính năng dở dang.

### Giai đoạn nào nên bổ sung (ước lượng)

| Tính năng bị hoãn | Thời điểm nên cân nhắc |
|-------------------|------------------------|
| Real-time collaboration | Sau khi có đủ user dùng đơn lẻ, có nhu cầu team |
| Export React/Vue/HTML | Phase 4/Post-MVP (cần schema ổn định trước) |
| Plugin marketplace | Khi có developer audience rõ ràng |
| Full Figma replacement | Không phải mục tiêu — hãy xác định vị trí riêng trên thị trường |
