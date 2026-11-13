// Drizzle Kit config (plan/08 infrastructure/database / apps/api db).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/ai_mockup_studio",
  },
  strict: true,
  verbose: true,
});
