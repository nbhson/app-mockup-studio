import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("db connection config (fix K)", () => {
  it("refuses to boot in production on the postgres:postgres dev fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", undefined);
    await expect(import("./index")).rejects.toThrow(/DATABASE_URL is required/);
  });

  it("boots in production when DATABASE_URL is explicit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@db.internal:5432/ai_mockup");
    const mod = await import("./index");
    expect(mod.pool.totalCount).toBe(0); // pool created, no connection yet
    await mod.pool.end();
  });

  it("keeps the localhost fallback for development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", undefined);
    const mod = await import("./index");
    expect(mod.pool.options.connectionString).toBe(
      "postgresql://postgres:postgres@localhost:5432/ai_mockup_studio",
    );
    await mod.pool.end();
  });
});
