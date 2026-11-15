import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import {
  DEFAULT_PALETTE,
  contrastText,
  extractPngPalette,
  mixHex,
  normalizeHex,
  paletteFromHexList,
  relativeLuminance,
  themeFromPalette,
  withThemeRoles,
} from "./design-reference";

// --- Tiny PNG encoder (RGB, 8-bit, no interlace) for deterministic tests ---

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function makePng(rows: string[][]): Buffer {
  const width = rows[0].length;
  const height = rows.length;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  rows.forEach((row, y) => {
    raw[y * (stride + 1)] = 0; // filter: none
    row.forEach((hex, x) => {
      const [r, g, b] = rgb(hex);
      const index = y * (stride + 1) + 1 + x * 3;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
    });
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const WHITE = "#FFFFFF";
const BLUE = "#2563EB";
const DARK = "#0F172A";
const RED = "#EF4444";

const PNG = makePng([
  [WHITE, WHITE, BLUE, BLUE],
  [WHITE, WHITE, BLUE, BLUE],
  [WHITE, WHITE, DARK, DARK],
  [WHITE, WHITE, RED, RED],
]);

describe("color helpers", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHex("#abcdef")).toBe("#ABCDEF");
    expect(normalizeHex("2563eb")).toBe("#2563EB");
    expect(normalizeHex("#abc")).toBeNull();
    expect(normalizeHex("not-a-color")).toBeNull();
  });

  it("computes luminance, mixing and contrast text", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(contrastText("#0F172A")).toBe("#FFFFFF");
    expect(contrastText("#FFFFFF")).toBe("#0F172A");
  });

  it("builds a descending palette from hex input and removes duplicates", () => {
    const palette = paletteFromHexList(["#ffffff", "#2563EB", "#FFFFFF", "bad"]);
    expect(palette).toHaveLength(2);
    expect(palette[0]).toMatchObject({ hex: "#FFFFFF" });
    expect(palette[0].share).toBeGreaterThan(palette[1].share);
  });
});

describe("extractPngPalette", () => {
  it("decodes dominant colors from an RGB PNG", () => {
    const palette = extractPngPalette(PNG);
    expect(palette).not.toBeNull();
    const hexes = palette!.map((color) => color.hex);
    expect(hexes).toContain(WHITE);
    expect(hexes).toContain(BLUE);
    expect(hexes).toContain(DARK);
    expect(hexes).toContain(RED);
    expect(palette![0].share).toBeGreaterThan(0.4);
  });

  it("returns null for unsupported or invalid data", () => {
    expect(extractPngPalette(Buffer.from("not a png"))).toBeNull();
    expect(extractPngPalette(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
  });
});

describe("themeFromPalette", () => {
  it("maps a light reference to light theme tokens", () => {
    const theme = themeFromPalette([
      { hex: WHITE, share: 0.5 },
      { hex: BLUE, share: 0.25 },
      { hex: DARK, share: 0.125 },
      { hex: RED, share: 0.125 },
    ]);

    expect(theme.mode).toBe("light");
    expect(theme.background).toBe(WHITE);
    expect(theme.foreground).toBe(DARK);
    expect(theme.primary).toBe(BLUE);
    expect(theme.primaryForeground).toBe("#FFFFFF");
    expect(theme.muted).not.toBe(theme.background);
    expect(theme.border).not.toBe(theme.background);
  });

  it("maps a dark reference to dark theme tokens", () => {
    const theme = themeFromPalette([
      { hex: "#0F172A", share: 0.6 },
      { hex: "#F8FAFC", share: 0.2 },
      { hex: "#38BDF8", share: 0.2 },
    ]);

    expect(theme.mode).toBe("dark");
    expect(theme.background).toBe("#0F172A");
    expect(theme.foreground).toBe("#F8FAFC");
    expect(theme.primary).toBe("#38BDF8");
  });

  it("falls back to the default palette when empty", () => {
    const theme = themeFromPalette([]);
    expect(theme.background).toBe(DEFAULT_PALETTE[1].hex);
    expect(theme.primary).toBe(DEFAULT_PALETTE[0].hex);
  });

  it("applies font and radius overrides and roles", () => {
    const theme = themeFromPalette(
      [
        { hex: WHITE, share: 0.5, role: "background" },
        { hex: DARK, share: 0.3, role: "foreground" },
        { hex: BLUE, share: 0.2, role: "primary" },
      ],
      { fontFamily: "Poppins, sans-serif", radius: 12 },
    );

    expect(theme.fontFamily).toBe("Poppins, sans-serif");
    expect(theme.radius).toBe(12);

    const roles = withThemeRoles(
      [
        { hex: WHITE, share: 0.5 },
        { hex: DARK, share: 0.3 },
        { hex: BLUE, share: 0.2 },
      ],
      theme,
    );
    expect(roles.map((color) => color.role)).toEqual([
      "background",
      "foreground",
      "primary",
    ]);
  });
});
