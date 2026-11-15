import { describe, expect, it } from "vitest";
import {
  knownComponentTypes,
  walkTree,
  type UiNode,
} from "@ai-mockup-studio/ui-schema";
import { uiDocumentSchema } from "@ai-mockup-studio/validators";
import { heuristicImageToUi, readImageSize } from "./image-to-ui";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function collectTypes(root: UiNode): string[] {
  const types: string[] = [];
  walkTree(root, (node) => types.push(node.type));
  return types;
}

describe("readImageSize", () => {
  it("reads PNG dimensions", () => {
    expect(readImageSize(Buffer.from(PNG_1x1, "base64"), "image/png")).toEqual({
      width: 1,
      height: 1,
    });
  });

  it("reads JPEG dimensions from the start-of-frame marker", () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 (length 4)
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, // SOF0, 100×200
      0x00, 0x00, 0x00, 0x00, // padding
    ]);
    expect(readImageSize(jpeg, "image/jpeg")).toEqual({ width: 200, height: 100 });
  });

  it("reads WebP VP8X dimensions", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0);
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8);
    webp.write("VP8X", 12);
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(199, 24, 3);
    webp.writeUIntLE(99, 27, 3);
    expect(readImageSize(webp, "image/webp")).toEqual({ width: 200, height: 100 });
  });

  it("returns null for unknown formats", () => {
    expect(readImageSize(Buffer.from("not an image"), "image/png")).toBeNull();
  });
});

describe("heuristicImageToUi", () => {
  it("builds a valid dashboard for a wide screenshot", () => {
    const document = heuristicImageToUi({
      width: 1440,
      height: 900,
      mimeType: "image/png",
      prompt: "Dashboard doanh thu",
    });

    expect(() => uiDocumentSchema.parse(document)).not.toThrow();
    expect(document.name).toContain("Dashboard doanh thu");
    expect(document.viewport).toEqual({ width: 1440, height: 900 });

    const types = collectTypes(document.root);
    expect(types).toContain("layout.sidebar");
    expect(types).toContain("dashboard.stats");
    expect(types).toContain("dashboard.chart");
    expect(types).toContain("dashboard.table");
    expect(types.every((type) => knownComponentTypes.includes(type))).toBe(true);
  });

  it("builds a mobile layout for a tall screenshot", () => {
    const document = heuristicImageToUi({
      width: 390,
      height: 844,
      mimeType: "image/png",
    });

    const types = collectTypes(document.root);
    expect(types).toContain("layout.navbar");
    expect(types).not.toContain("layout.sidebar");
    expect(document.viewport).toEqual({ width: 390, height: 844 });
  });

  it("builds a form layout when the prompt asks for sign-up", () => {
    const document = heuristicImageToUi({
      width: 1200,
      height: 900,
      mimeType: "image/png",
      prompt: "Trang đăng ký tài khoản",
    });

    const types = collectTypes(document.root);
    expect(types).toContain("formal.form");
    expect(types).toContain("basic.input");
    expect(types).toContain("basic.button");
  });

  it("builds a landing layout for marketing prompts", () => {
    const document = heuristicImageToUi({
      width: 1200,
      height: 900,
      mimeType: "image/png",
      prompt: "Landing page giới thiệu sản phẩm",
    });

    const types = collectTypes(document.root);
    expect(types).toContain("layout.navbar");
    expect(types).toContain("basic.image");
    expect(types).toContain("formal.card");
  });

  it("always produces unique ids", () => {
    const document = heuristicImageToUi({
      width: 1440,
      height: 900,
      mimeType: "image/png",
    });
    const ids: string[] = [];
    walkTree(document.root, (node) => ids.push(node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
