// ---------------------------------------------------------------------------
// AI design reference (plan/07 3.3).
//
// Extracts a dominant-color palette from a reference image and maps it to the
// studio's Theme tokens. PNG files are decoded locally (zlib + scanline
// filters) so the feature works without native image dependencies. The web
// dialog can also extract a palette with canvas for JPEG/WebP and send it in.
// ---------------------------------------------------------------------------

import { inflateSync } from "node:zlib";
import type { Theme } from "@ai-mockup-studio/ui-schema";

export interface PaletteColor {
  hex: string;
  share: number;
  role?: "background" | "foreground" | "primary";
}

export const DEFAULT_PALETTE: PaletteColor[] = [
  { hex: "#2563EB", share: 0.35 },
  { hex: "#F8FAFC", share: 0.3 },
  { hex: "#0F172A", share: 0.2 },
  { hex: "#64748B", share: 0.1 },
  { hex: "#E2E8F0", share: 0.05 },
];

// --- Color math ------------------------------------------------------------

export function normalizeHex(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex) ?? "#000000";
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

export function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

export function contrastText(background: string): string {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#0F172A")
    ? "#FFFFFF"
    : "#0F172A";
}

function saturation(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function paletteFromHexList(hexes: string[]): PaletteColor[] {
  const unique = [...new Set(hexes.map(normalizeHex).filter((hex): hex is string => !!hex))];
  if (unique.length === 0) return [];
  const total = (unique.length * (unique.length + 1)) / 2;
  return unique.map((hex, index) => ({
    hex,
    share: (unique.length - index) / total,
  }));
}

/** Map a dominant-color palette to the studio's theme tokens. */
export function themeFromPalette(
  colors: PaletteColor[],
  overrides: { fontFamily?: string; radius?: number } = {},
): Theme {
  const palette = colors.length > 0 ? colors : DEFAULT_PALETTE;
  const sorted = [...palette].sort((a, b) => b.share - a.share);
  const mostCommon = sorted[0];

  const background =
    sorted.find((color) => color.role === "background")?.hex ??
    (mostCommon.share >= 0.4
      ? mostCommon.hex
      : (sorted.find((color) => relativeLuminance(color.hex) > 0.55)?.hex ??
        mostCommon.hex));

  const backgroundLuminance = relativeLuminance(background);
  const foregroundCandidates = sorted.filter((color) => color.hex !== background);
  let foreground =
    sorted.find((color) => color.role === "foreground")?.hex ??
    [...foregroundCandidates].sort((a, b) =>
      backgroundLuminance > 0.4
        ? relativeLuminance(a.hex) - relativeLuminance(b.hex)
        : relativeLuminance(b.hex) - relativeLuminance(a.hex),
    )[0]?.hex ??
    "#0F172A";
  if (contrastRatio(foreground, background) < 4.5) {
    foreground = backgroundLuminance > 0.4 ? "#0F172A" : "#F8FAFC";
  }

  const primary =
    sorted.find((color) => color.role === "primary")?.hex ??
    [...sorted]
      .filter((color) => color.hex !== background && color.hex !== foreground)
      .sort((a, b) => saturation(b.hex) - saturation(a.hex) || b.share - a.share)[0]
      ?.hex ??
    "#2563EB";

  const mode = relativeLuminance(background) < 0.4 ? "dark" : "light";
  const muted = mixHex(background, foreground, mode === "dark" ? 0.12 : 0.05);
  const border = mixHex(background, foreground, mode === "dark" ? 0.2 : 0.12);
  const mutedForeground = mixHex(background, foreground, 0.55);

  return {
    mode,
    primary,
    primaryForeground: contrastText(primary),
    background,
    foreground,
    muted,
    mutedForeground,
    border,
    fontFamily: overrides.fontFamily ?? "Inter, system-ui, sans-serif",
    radius: overrides.radius ?? 8,
  };
}

/** Attach semantic roles to the palette entries that match the final theme. */
export function withThemeRoles(colors: PaletteColor[], theme: Theme): PaletteColor[] {
  return colors.map((color) => {
    if (color.hex === theme.background) return { ...color, role: "background" };
    if (color.hex === theme.foreground) return { ...color, role: "foreground" };
    if (color.hex === theme.primary) return { ...color, role: "primary" };
    return { ...color, role: undefined };
  });
}

// --- PNG decoding ----------------------------------------------------------

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  if (du <= dul) return up;
  return upLeft;
}

/**
 * Decode 8-bit non-interlaced RGB/RGBA PNGs and return dominant colors.
 * Returns null for formats we do not decode (the caller falls back to a
 * client-provided palette or the default theme).
 */
export function extractPngPalette(data: Buffer): PaletteColor[] | null {
  if (data.length < 33 || data.readUInt32BE(0) !== 0x89504e47) return null;

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > data.length) break;

    if (type === "IHDR" && length >= 13) {
      width = data.readUInt32BE(start);
      height = data.readUInt32BE(start + 4);
      bitDepth = data[start + 8];
      colorType = data[start + 9];
      const compression = data[start + 10];
      const filter = data[start + 11];
      interlace = data[start + 12];
      if (compression !== 0 || filter !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(data.subarray(start, end));
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }

  if (
    bitDepth !== 8 ||
    interlace !== 0 ||
    (colorType !== 2 && colorType !== 6) ||
    width === 0 ||
    height === 0 ||
    idat.length === 0
  ) {
    return null;
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length < height * (stride + 1)) return null;

  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const source = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const target = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? target[x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = source[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value = (value + left) & 0xff;
          break;
        case 2:
          value = (value + up) & 0xff;
          break;
        case 3:
          value = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          value = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          return null;
      }
      target[x] = value;
    }
  }

  const buckets = new Map<
    number,
    { r: number; g: number; b: number; count: number }
  >();
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 12000)));
  let samples = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = y * stride + x * channels;
      const alpha = channels === 4 ? pixels[index + 3] : 255;
      if (alpha < 128) continue;
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      buckets.set(key, bucket);
      samples += 1;
    }
  }

  if (samples === 0) return null;

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((bucket) => ({
      hex: rgbToHex(
        bucket.r / bucket.count,
        bucket.g / bucket.count,
        bucket.b / bucket.count,
      ),
      share: bucket.count / samples,
    }));
}
