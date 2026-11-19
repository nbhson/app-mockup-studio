import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
import { resolveTrustProxy } from "./common/trust-proxy";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Rate limiting and other IP-based logic are only correct behind a reverse
  // proxy (nginx, Cloud Run, ALB) when Express trusts the `X-Forwarded-For`
  // hop chain. Without this, `req.ip` is always the proxy's address and every
  // client shares one bucket. Opt in with TRUST_PROXY: a hop count
  // (e.g. "1", "2") or "true" (= trust one immediate proxy). Left unset the
  // app trusts nothing, which is the safe default for direct/dev traffic.
  app.set("trust proxy", resolveTrustProxy(process.env.TRUST_PROXY));

  // Image uploads travel as base64 JSON (2 MiB file ≈ 2.7 MB body), so the
  // default 100 kB body-parser limit is too small.
  app.useBodyParser("json", { limit: "8mb" });

  // Only the configured web app(s) may call the API from a browser. The Vite
  // dev server proxies /api (same-origin), so this mainly protects direct
  // cross-origin usage. Set WEB_ORIGIN to a comma-separated allowlist in prod.
  const allowedOrigins = (
    process.env.WEB_ORIGIN ??
    "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-share-password",
      "x-user-email",
    ],
  });

  app.setGlobalPrefix("api");
  // Request bodies are validated with Zod schemas (validators package) in each
  // controller/service; Nest's class-validator pipe is intentionally not used.
  // The filter turns ZodError into a 400 with field-level details.
  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API ready on http://localhost:${port}/api`);
}
void bootstrap();
