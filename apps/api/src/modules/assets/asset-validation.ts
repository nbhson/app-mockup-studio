import { BadRequestException } from "@nestjs/common";

/** 2 MiB — generous for mockups while keeping JSON bodies reasonable. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * Magic-byte signatures. Validating the decoded bytes (not just the declared
 * MIME type) means a renamed script/HTML file can never be served back as an
 * image. SVG is intentionally unsupported: it can carry executable script.
 */
const MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }[]> = {
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  ],
};

export function matchesImageSignature(data: Buffer, mimeType: string): boolean {
  const rules = MAGIC_BYTES[mimeType];
  if (!rules) return false;
  return rules.every((rule) =>
    rule.bytes.every((byte, index) => data[rule.offset + index] === byte),
  );
}

/**
 * Decodes a base64 body (optionally prefixed with a `data:` URL) and enforces
 * size + magic-byte rules. Throws a 400 with a user-facing message.
 */
export function validateAssetData(
  dataBase64: string,
  mimeType: string,
  maxBytes = MAX_ASSET_BYTES,
): Buffer {
  // Accept (and strip) a data: URL prefix so clients can pass FileReader
  // output directly without extra parsing.
  const base64 = dataBase64.replace(/^data:[^;]+;base64,/, "");
  const data = Buffer.from(base64, "base64");

  if (data.length === 0) {
    throw new BadRequestException("Tệp rỗng hoặc không phải base64 hợp lệ");
  }
  if (data.length > maxBytes) {
    throw new BadRequestException(
      `Tệp vượt quá giới hạn ${Math.round(maxBytes / 1024 / 1024)} MB`,
    );
  }
  if (!matchesImageSignature(data, mimeType)) {
    throw new BadRequestException(
      "Nội dung tệp không khớp định dạng ảnh đã khai báo",
    );
  }

  return data;
}
