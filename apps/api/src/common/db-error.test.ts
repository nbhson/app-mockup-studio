import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./db-error";

describe("isUniqueViolation", () => {
  it("recognises the Postgres SQLSTATE for unique_violation", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(
      true,
    );
  });

  it("is false for other driver errors and non-errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
