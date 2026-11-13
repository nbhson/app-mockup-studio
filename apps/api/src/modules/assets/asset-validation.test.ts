import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MAX_ASSET_BYTES, matchesImageSignature, validateAssetData } from "./asset-validation";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex");
const GIF = Buffer.from("474946383961010001000000", "hex");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from("00000000", "hex"),
  Buffer.from("WEBP", "ascii"),
]);

function expectBadRequest(fn: () => unknown): void {
  try {
    fn();
    throw new Error("expected a BadRequestException");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  }
}

describe("asset validation", () => {
  it("accepts each supported image signature", () => {
    expect(matchesImageSignature(PNG, "image/png")).toBe(true);
    expect(matchesImageSignature(JPEG, "image/jpeg")).toBe(true);
    expect(matchesImageSignature(GIF, "image/gif")).toBe(true);
    expect(matchesImageSignature(WEBP, "image/webp")).toBe(true);
  });

  it("decodes base64 and strips an optional data URL prefix", () => {
    const plain = validateAssetData(PNG.toString("base64"), "image/png");
    const prefixed = validateAssetData(
      `data:image/png;base64,${PNG.toString("base64")}`,
      "image/png",
    );
    expect(plain.equals(PNG)).toBe(true);
    expect(prefixed.equals(PNG)).toBe(true);
  });

  it("rejects content whose bytes do not match the declared MIME type", () => {
    expectBadRequest(() => validateAssetData(PNG.toString("base64"), "image/jpeg"));
  });

  it("rejects unsupported formats such as SVG", () => {
    const svg = Buffer.from("<svg></svg>", "utf8");
    expectBadRequest(() => validateAssetData(svg.toString("base64"), "image/svg+xml"));
  });

  it("rejects empty and oversized payloads", () => {
    expectBadRequest(() => validateAssetData("", "image/png"));
    const oversized = Buffer.alloc(MAX_ASSET_BYTES + 1, 0).toString("base64");
    expectBadRequest(() => validateAssetData(oversized, "image/png"));
  });
});
