import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// The `postgres:postgres` localhost default is a development convenience. In
// production it must NEVER apply: a missed DATABASE_URL would silently boot
// the app against a well-known credential set (or an unrelated local DB),
// losing every deployment guardrail. Fail fast at import time instead.
const fallbackConnectionString =
  "postgresql://postgres:postgres@localhost:5432/ai_mockup_studio";

const connectionString =
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error(
          "DATABASE_URL is required when NODE_ENV=production (the local development fallback is disabled).",
        );
      })()
    : fallbackConnectionString);

export const pool = new Pool({ connectionString, max: 10 });

export const db = drizzle(pool, { schema });
