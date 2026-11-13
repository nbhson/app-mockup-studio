# 📋 Mục lục Plan — AI Mockup Studio

Đây là bộ tài liệu kế hoạch đầy đủ cho dự án **AI Mockup Studio** — ứng dụng AI tạo UI mockup. Toàn bộ nội dung được **phân tích, tổng hợp và mở rộng** từ cuộc hội thoại ChatGPT chia sẻ ngày **10/11/2026**:

🔗 https://chatgpt.com/share/6af2d25b-0f84-83ec-aacf-8e60a35854ed

---

## Cách đọc bộ tài liệu

- Đọc **README.md** (root) để nắm tầm nhìn chung.
- Đọc tuần tự từ **01 → 14** để theo đúng logic mà hội thoại đề ra.
- Mỗi tài liệu chứa: nội dung gốc từ ChatGPT + **gợi ý phân tích / mở rộng** của tài liệu này (marked với các box "💡 Phân tích").
- File **00** là transcript gốc tham khảo.

---

## Danh sách tài liệu

| # | File | Nội dung chính |
|---|------|----------------|
| 00 | [00-nguon-tham-khao.md](./00-nguon-tham-khao.md) | Transcript chi tiết cuộc hội thoại ChatGPT gốc |
| 01 | [01-product-vision.md](./01-product-vision.md) | Tầm nhìn sản phẩm, 3 nhóm đầu ra, workflow người dùng |
| 02 | [02-architecture.md](./02-architecture.md) | Kiến trúc tổng quan, modular monolith, rendering engine |
| 03 | [03-tech-stack.md](./03-tech-stack.md) | Frontend / Backend / DB / AI Layer |
| 04 | [04-ai-generation-pipeline.md](./04-ai-generation-pipeline.md) | Pipeline Text-to-UI 7 bước |
| 05 | [05-ui-schema.md](./05-ui-schema.md) | UI Schema (trái tim), ví dụ JSON, cơ chế patch |
| 06 | [06-frontend-workspace.md](./06-frontend-workspace.md) | Workspace editor 4 khu vực |
| 07 | [07-feature-roadmap.md](./07-feature-roadmap.md) | Roadmap 4 giai đoạn (MVP → Enterprise) + **effort estimation** |
| 08 | [08-project-structure.md](./08-project-structure.md) | Cấu trúc monorepo pnpm + Turborepo |
| 09 | [09-architecture-considerations.md](./09-architecture-considerations.md) | 4 vấn đề kiến trúc cần giải quyết sớm |
| 10 | [10-database-design.md](./10-database-design.md) | Entity, ER diagram, lưu ý component |
| 11 | [11-what-not-to-do.md](./11-what-not-to-do.md) | Những thứ KHÔNG nên làm ngay |
| 12 | [12-implementation-roadmap.md](./12-implementation-roadmap.md) | Lộ trình triển khai 6 giai đoạn + **effort estimation + acceptance criteria** |
| 13 | [13-decisions-to-make.md](./13-decisions-to-make.md) | 5 quyết định kiến trúc cần chốt |
| 14 | [14-custom-ai-provider.md](./14-custom-ai-provider.md) | Custom provider (API key / Base URL / Model) chi tiết |

---

## 🕐 Quy ước ước lượng (nằm trong 07 và 12)

- Đơn vị: **ideal hours** (giờ tập trung — không tính meeting/admin/task switching).
- Giả định đội: **2 dev** (1 Frontend + 1 Backend) làm song song; hours là tổng nỗ lực toàn đội.
- Nếu chỉ **1 dev full-stack** → nhân hệ số ~1.2–1.4.
- Mỗi mục thường có **dải min–max** kèm **task breakdown** và **acceptance criteria (DoD)**.

---

## Nguồn dữ liệu

- **Nguồn chính:** Cuộc hội thoại ChatGPT chia sẻ (link ở trên), gồm 3 message người dùng và câu trả lời của ChatGPT về:
  1. Yêu cầu tư vấn kiến trúc / tech stack / tính năng ban đầu.
  2. Trả lời tổng thể 12 mục về kiến trúc và roadmap.
  3. Hỏi về khả năng custom provider (apiKey, baseURL, model).
  4. Trả lời chi tiết về Custom AI Provider Configuration.
- **Trích xuất:** toàn bộ nội dung được lấy từ HTML SSR của trang chia sẻ (kèm phần cuối hội thoại bị gián đoạn do lỗi kết nối ChatGPT).
