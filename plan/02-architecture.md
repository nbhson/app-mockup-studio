# 02 — Kiến trúc tổng quan (High-level architecture)

> Nguồn: mục #2 của hội thoại ChatGPT + phân tích mở rộng.

---

## Chiến lược kiến trúc

Đề xuất kiến trúc **modular monolith** ở backend ban đầu, kết hợp:
- **Frontend component-based**
- **AI orchestration layer độc lập**

> Lý do: MVP chưa cần microservices (xem [11-what-not-to-do.md](./11-what-not-to-do.md)), nhưng cần tách biệt rõ các module để dễ mở rộng.

---

## System architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend – AI Mockup Studio"]
        WS[Workspace · Canvas · Chat · Inspector · Preview]
    end

    subgraph API["API Gateway / Backend"]
        AUTH[Auth] --> PRJ[Project]
        PRJ --> VER[Version] --> AST[Asset] --> COL[Collaboration]
    end

    subgraph AI["AI Orchestration Layer"]
        PE[Prompt Engine] --> II[Intent analysis]
        II --> AW[Agent Workflow] --> TO[Task orchestration]
        TO --> UG[UI Generator] --> CG[Component generation]
        UG --> VAL[Validator] --> SC[Schematic and quality checks]
    end

    subgraph DL["Data Layer"]
        PG[(PostgreSQL)]
        RD[(Redis)]
        OS[(Object Storage)]
    end

    subgraph AP["AI Providers"]
        C[Cloud LLM]
        L[Local LLM]
        IM[Image models]
    end

    subgraph RE["Rendering Engine"]
        SC1[JSON UI Schema] --> CT[Component Tree] --> VC[Visual Canvas]
    end

    Frontend <--> API
    API <--> AI
    AI --> DL
    API --> DL
    AI --> AP
```

**Chú thích các tầng:**

| Tầng | Thành phần chính |
|------|-----------------|
| **Frontend** | Workspace · Canvas · Chat · Inspector · Preview |
| **API Gateway / Backend** | Auth · Project · Version · Asset · Collaboration |
| **AI Orchestration Layer** | Prompt Engine · Intent analysis · Agent Workflow · UI Generator · Validator |
| **Data Layer** | PostgreSQL · Redis · Object Storage |
| **AI Providers** | Cloud LLM · Local LLM · Image models |
| **Rendering Engine** | JSON UI Schema → Component Tree → Visual Canvas |

Các hoạt động: **Events, streaming, persistence** — nối xuyên suốt hệ thống.

---

## Điểm kiến trúc quan trọng nhất

> AI **không nên trực tiếp sinh và thực thi code tùy ý trong canvas**.

Thay vào đó:
1. AI sinh ra một **cấu trúc dữ liệu UI có schema xác định** (JSON UI Schema).
2. **Renderer của ứng dụng** chịu trách nhiệm hiển thị cấu trúc đó.

### Lợi ích

- ✅ Kiểm soát được component được sinh ra.
- ✅ Dễ chỉnh sửa từng thành phần.
- ✅ Hỗ trợ Undo/Redo.
- ✅ Lưu version và compare.
- ✅ Tránh việc AI sinh code không an toàn.
- ✅ Dễ dàng chuyển đổi sang nhiều framework.

---

## 💡 Phân tích & mở rộng

### Luồng dữ liệu đề xuất

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend (Canvas)
    participant API as Backend API
    participant AI as AI Orchestration
    participant DB as PostgreSQL

    U->>FE: Nhập prompt mô tả UI
    FE->>API: POST /generate (prompt)
    API->>AI: Dispatch generation job
    AI->>AI: Requirement Analyzer → Design Planner → Schema Generator → Validator
    AI-->>API: Trả về JSON UI Schema
    API->>DB: Lưu document version
    API-->>FE: Stream schema qua SSE
    FE->>FE: Rendering Engine render canvas
    FE-->>U: Hiển thị mockup chỉnh sửa được
```

### Vì sao modular monolith cho MVP?

- **Đơn giản để triển khai và debug.**
- **Vẫn rõ ràng module boundaries** — sau này tách thành service độc lập khi cần scale.
- AI orchestration được thiết kế như một module với interface rõ ràng để dễ nâng cấp.

### Điểm cần chốt

1. Backend có stream kết quả AI qua **SSE** hay có job queue (BullMQ) xử lý bất đồng bộ? (Đề xuất: kết hợp — queue để chạy job, SSE để stream về client).
2. Việc **persistence** versioning document nằm ở backend ngay từ đầu hay chỉ local-first? (Xem [08-project-structure.md](./08-project-structure.md) và [10-database-design.md](./10-database-design.md)).
