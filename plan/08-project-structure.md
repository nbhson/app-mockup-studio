# 08 — Project Folder Structure (Cấu trúc dự án)

> Nguồn: mục #7 của hội thoại ChatGPT + phân tích mở rộng.

---

## Tổng quan

Đề xuất **monorepo** với **pnpm workspace** và **Turborepo**.

```text
ai-mockup-studio/
│
├── apps/
│   ├── web/                    # Vue 3 application
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── modules/
│   │   │   │   ├── workspace/
│   │   │   │   ├── canvas/
│   │   │   │   ├── layers/
│   │   │   │   ├── inspector/
│   │   │   │   ├── ai-assistant/
│   │   │   │   ├── projects/
│   │   │   │   └── assets/
│   │   │   ├── components/
│   │   │   ├── composables/
│   │   │   ├── stores/
│   │   │   └── router/
│   │   └── package.json
│   │
│   └── api/                    # NestJS backend
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── projects/
│       │   │   ├── documents/
│       │   │   ├── versions/
│       │   │   ├── assets/
│       │   │   ├── ai/
│       │   │   └── export/
│       │   └── common/
│       └── package.json
│
├── packages/
│   ├── ui-schema/               # Schema definitions
│   ├── ui-renderer/             # Schema → component
│   ├── design-system/           # Design tokens
│   ├── ai-core/                 # AI abstractions
│   ├── ai-prompts/              # Prompt templates
│   ├── shared-types/            # Shared TypeScript types
│   └── validators/              # Zod schemas
│
├── infrastructure/
│   ├── docker/
│   ├── database/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── api/
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## Điểm quan trọng (bất biến kiến trúc)

> ⚠️ **`ui-schema`, `ui-renderer` và `design-system` phải là các package độc lập, không phụ thuộc trực tiếp vào AI provider.**

Lý do:
- Đảm bảo **schema & rendering có thể hoạt động độc lập** (dù AI có chạy hay không).
- Khi thêm provider AI mới, **không phải sửa** UI Schema Engine hay Rendering Engine.
- Ai-core / ai-prompts đổi được mà schema/rendering không bị ảnh hưởng.

---

## 💡 Phân tích & mở rộng

### Vai trò từng package (chi tiết hóa)

| Package | Nội dung chính |
|---------|----------------|
| `ui-schema` | Định nghĩa type/ký hiệu của UI Schema (page, component, patch, viewport, theme) |
| `ui-renderer` | Chuyển schema → component tree → DOM canvas; xử lý patch |
| `design-system` | Design tokens (màu, typography, spacing, radius, shadow); có thể seeds providers |
| `ai-core` | Abstraction AI Provider (interface, adapter), ModelRouter, capability model |
| `ai-prompts` | Prompt templates cho từng task (generation, editing, analysis, image-to-UI) |
| `shared-types` | Các TypeScript types dùng chung giữa web & api |
| `validators` | Zod schemas tương ứng — validate runtime ở cả 2 phía |

### Đề xuất về dependency direction

```text
web  → ui-renderer → ui-schema, design-system
api  → ai-core → ai-prompts
api  → validators, shared-types
web  → validators, shared-types
```

- **Không ai phụ thuộc vào ai-core ở tầng schema/design** (bảo toàn nguyên tắc trên).
- `infrastructure/` tách biệt database migrations & docker để deploy sạch sẽ.
- `docs/adr/` — ghi lại các quyết định kiến trúc (ADRs) — xem [13-decisions-to-make.md](./13-decisions-to-make.md).

### Lưu ý cho thư mục `apps/web/src/modules/*`

Các module (workspace, canvas, layers, inspector, ai-assistant, projects, assets) đã phản ánh đúng **bố cục 4 khu vực** trong [06-frontend-workspace.md](./06-frontend-workspace.md) — mỗi module là một feature tự chứa (components, stores, composables riêng).
