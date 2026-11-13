# 13 — Những quyết định cần chốt trước khi bắt đầu

> Nguồn: mục #12 của hội thoại ChatGPT + phân tích mở rộng.

---

## Tổng quan

Đây là **5 quyết định ảnh hưởng lớn nhất** đến toàn bộ architecture. Cần chốt trước khi bắt đầu (dựa theo kinh nghiệm Vue/Angular + đang tìm hiểu local LLM qua llama.cpp).

---

## Architecture decision draft

### 1. Frontend framework

| Lựa chọn | Cân nhắc |
|----------|----------|
| ✅ **Vue 3 + TypeScript** | Tận dụng kinh nghiệm và codebase hiện tại. |
| React + TypeScript | Hệ sinh thái visual editor phong phú hơn. |

> Khuyến nghị ban đầu của hội thoại: **Vue 3 + TypeScript**.

### 2. AI output strategy

| Lựa chọn | Cân nhắc |
|----------|----------|
| ✅ **JSON UI Schema** (khuyến nghị) | Kiểm soát, dễ chỉnh sửa, versioning, không an toàn code. |
| Generate React/Vue source code trực tiếp | Khó kiểm soát & chỉnh sửa. |
| **Hybrid** — Schema trước, code export sau | Tốt cho tương lai (Phase 4 export code). |

> Khuyến nghị: **JSON UI Schema** làm chiến lược output, với hướng **Hybrid** khi tới Phase 4.

### 3. Canvas rendering technology

| Lựa chọn | Cân nhắc |
|----------|----------|
| ✅ **DOM-based renderer** (khuyến nghị cho MVP) | Đơn giản, tương thích Vue, dễ debugging, dễ chỉnh sửa. |
| SVG-based editor | Cần cho những thao tác đồ họa phức tạp hơn. |
| HTML Canvas / WebGL | Performance cao nhưng phức tạp, khó tương tác kiểu DOM. |

> Khuyến nghị: **DOM-based** cho MVP.

### 4. AI infrastructure

| Lựa chọn | Cân nhắc |
|----------|----------|
| ✅ **Hybrid Cloud + Local LLM** | Linh hoạt, tận dụng local (llama.cpp) + cloud cho tác vụ nặng. |
| Cloud AI only | Đơn giản nhưng phụ thuộc vendor & chi phí. |
| Local LLM only | Rẻ, riêng tư nhưng chất lượng hạn chế cho tác vụ phức tạp. |

> Khuyến nghị: **Hybrid** — với khả năng custom provider (API key/Base URL/Model) — xem [14-custom-ai-provider.md](./14-custom-ai-provider.md).

### 5. Product scope

| Lựa chọn | Cân nhắc |
|----------|----------|
| ✅ **MVP** — Single-page mockup builder | Tập trung, dễ ra mắt. |
| Full UI Builder platform | Scope lớn, mất nhiều thời gian. |
| Enterprise UI design platform | Cần nhiều tính năng collaboration, RBAC... |

> Khuyến nghị: Bắt đầu với **MVP — Single-page mockup builder**, mở rộng dần.

---

## 🔮 Bước tiếp theo đề xuất (sau khi chốt)

Sau khi chốt các lựa chọn trên, có thể xây dựng bản **Technical Architecture Blueprint v1**, bao gồm:

- [ ] Mermaid architecture diagrams.
- [ ] Module boundaries.
- [ ] Sequence diagrams.
- [ ] Database schema.
- [ ] API contracts.
- [ ] Implementation backlog.

> Cũng nên lưu các quyết định này thành **ADR (Architecture Decision Records)** trong thư mục `docs/adr/` như đề xuất ở [08-project-structure.md](./08-project-structure.md).

---

## 💡 Phân tích & mở rộng

### Ma trận lựa chọn theo mục tiêu (đề xuất)

| Mục tiêu ưu tiên | Frontend | AI output | Canvas | AI infra | Scope |
|------------------|----------|-----------|--------|----------|-------|
| Ra mắt nhanh MVP | Vue 3 | JSON Schema | DOM | Hybrid / Cloud | MVP |
| Tối đa flexibility | — | Hybrid | — | Hybrid | Full platform |
| Chất lượng design cao | React (nếu cần) | JSON Schema | DOM + SVG sau | Cloud | Enterprise |

### Checklist trước khi code

1. ✅ Chốt **UI Schema** (v0.1) — nền tảng mọi thứ.
2. ✅ Chốt **Component Registry** (danh sách component ban đầu).
3. ✅ Chốt **Design Tokens** (palette, typography, spacing).
4. ✅ Quyết định **monorepo tooling** (pnpm + Turborepo).
5. ✅ Quyết định **AI Provider abstraction** phạm vi MVP (chỉ OpenAI-compatible + custom?).
