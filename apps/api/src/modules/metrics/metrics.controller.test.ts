import { afterEach, describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";

const snapshot = { requests: 1 } as never;
const metrics = { snapshot: () => snapshot };

afterEach(() => {
  delete process.env.METRICS_TOKEN;
});

describe("MetricsController token check (fix K)", () => {
  it("is open when METRICS_TOKEN is unset", () => {
    const controller = new MetricsController(metrics as never);
    expect(controller.getMetrics()).toBe(snapshot);
  });

  it("accepts the token via Bearer or x-metrics-token", () => {
    process.env.METRICS_TOKEN = "secret-token-value";
    const controller = new MetricsController(metrics as never);
    expect(controller.getMetrics("Bearer secret-token-value")).toBe(snapshot);
    expect(controller.getMetrics(undefined, "secret-token-value")).toBe(snapshot);
  });

  it("rejects missing, wrong and different-length tokens with 401 — no timingSafeEqual crash", () => {
    process.env.METRICS_TOKEN = "secret-token-value";
    const controller = new MetricsController(metrics as never);

    expect(() => controller.getMetrics()).toThrow(UnauthorizedException);
    expect(() => controller.getMetrics("Bearer nope")).toThrow(UnauthorizedException);
    // A shorter prefix of the real token used to be compared byte-wise with
    // `!==`; with timingSafeEqual it must return 401 instead of throwing a
    // RangeError on the length mismatch.
    expect(() => controller.getMetrics("Bearer secret")).toThrow(UnauthorizedException);
    expect(() =>
      controller.getMetrics(undefined, "secret-token-value-longer-wrong"),
    ).toThrow(UnauthorizedException);
  });

  it("compares UTF-8 BYTES, so multibyte tokens of equal char length still work", () => {
    process.env.METRICS_TOKEN = "mật-khẩu-metrics";
    const controller = new MetricsController(metrics as never);
    expect(() => controller.getMetrics("Bearer mật-khẩu-metrics")).not.toThrow();
    expect(() => controller.getMetrics("Bearer mat-khau-metrics")).toThrow(
      UnauthorizedException,
    );
  });
});
