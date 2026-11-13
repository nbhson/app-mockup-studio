import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ZodExceptionFilter } from "./zod-exception.filter";

describe("ZodExceptionFilter", () => {
  it("maps Zod issues to a 400 with field-level details", () => {
    const result = z
      .object({ name: z.string().min(1, "Tên không được rỗng"), age: z.number() })
      .safeParse({ name: "", age: "not-a-number" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected validation to fail");

    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    new ZodExceptionFilter().catch(result.error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledTimes(1);
    const payload = json.mock.calls[0][0] as {
      statusCode: number;
      error: string;
      message: string;
      issues: { path: string; message: string }[];
    };
    expect(payload.statusCode).toBe(400);
    expect(payload.error).toBe("Bad Request");
    expect(payload.issues).toHaveLength(2);
    expect(payload.issues[0]).toMatchObject({ path: "name", message: "Tên không được rỗng" });
    expect(payload.issues[1].path).toBe("age");
    expect(payload.message).toContain("name:");
  });
});
