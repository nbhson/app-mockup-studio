# Infrastructure

## Local development

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

Starts PostgreSQL 17 (`localhost:5432`, user/password `postgres/postgres`) and
Redis (`localhost:6379`). The Redis instance backs the shared rate limiter when
`REDIS_URL` is set on the API (see `apps/api/.env.example`); without it the API
uses an in-process limiter valid for a single instance.

## Production deployment (runbook)

The MVP is a single Node API + static web build. Any host with Node 22 and
PostgreSQL 16+ works (VM, Fly.io, Railway, Render, Kubernetes...).

### 1. Build artifacts

```bash
pnpm install --frozen-lockfile
pnpm build           # packages + API dist + web dist
```

Artifacts:

- API: `apps/api/dist/main.js` (+ workspace packages in `node_modules`)
- Web: `apps/web/dist` (static files, serve with Nginx/Cloudflare Pages)

### 2. Environment

Copy `apps/api/.env.example` and set at minimum:

```dotenv
DATABASE_URL=postgresql://user:password@db-host:5432/ai_mockup_studio
PORT=3000
WEB_ORIGIN=https://app.example.com
AI_RATE_LIMIT=20
METRICS_TOKEN=<long-random-token>
APP_VERSION=<git-sha-or-release>
# Optional real LLM:
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

Never commit `.env`; keep `OPENAI_API_KEY` server-side only.

### 3. Migrate and start

```bash
pnpm db:migrate
pnpm db:seed        # only once for a fresh demo environment
node apps/api/dist/main.js
```

Run the API under a process manager (systemd, PM2, container orchestrator) and
restart on failure. The process handles `SIGTERM` via Nest shutdown hooks.

Sample systemd unit:

```ini
[Unit]
Description=AI Mockup Studio API
After=network.target postgresql.service

[Service]
WorkingDirectory=/srv/ai-mockup-studio
EnvironmentFile=/srv/ai-mockup-studio/apps/api/.env
ExecStart=/usr/bin/node apps/api/dist/main.js
Restart=always
RestartSec=3
User=app
Group=app

[Install]
WantedBy=multi-user.target
```

### 4. Reverse proxy (Nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  root /srv/ai-mockup-studio/apps/web/dist;
  index index.html;
  try_files $uri $uri/ /index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 10m;   # asset uploads: base64 JSON up to 8 MB
  }
}
```

Set `WEB_ORIGIN` to the exact browser origin. If the web app and API are on
different origins, add both to the comma-separated allowlist.

### 5. Health, metrics, alerts

- Liveness: `GET /api/health` (503 when PostgreSQL is unreachable).
- Metrics: `GET /api/metrics` with `Authorization: Bearer $METRICS_TOKEN`.
  `alerts[]` is non-empty when error rate, p95 latency or AI fallback rate
  crosses the configured thresholds. Scrape this endpoint into your monitoring
  stack or poll it with a cron/alert rule.
- Logs: 5xx responses and slow requests (> `SLOW_REQUEST_MS`) are logged with
  an `x-request-id` correlation header.

### 6. Rollback

- Keep the previous release directory (or container image) and switch the
  symlink/image tag back; the API is stateless apart from PostgreSQL.
- Take a database backup before applying migrations. Drizzle migrations are
  forward-only: for schema rollback, restore the backup or write a compensating
  migration.
- Document versions are never deleted automatically; a bad content change can
  be reverted from the in-app version history.

### Known production follow-ups

- Metrics are in-memory per instance; export to Prometheus/OpenTelemetry for
  aggregate dashboards and long-term retention.
- Move asset bytes from PostgreSQL to S3/R2 when files grow beyond the MVP
  limit (currently ≤ 2 MiB per asset).
