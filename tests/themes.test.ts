import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { layout, type Project } from "../src/layout/layout.js";
import type { RenderModel } from "../src/render/model.js";
import { toPng } from "../src/render/png.js";
import { toSvg } from "../src/render/svg.js";
import { resolveTheme, THEME_NAMES, THEMES, type ThemeName } from "../src/render/themes.js";

const summingAmpPath = join(import.meta.dirname, "..", "examples", "summing-amp.schem.json");
const summingAmpProject = JSON.parse(readFileSync(summingAmpPath, "utf8")) as Project;
const summingAmpLayout = layout(summingAmpProject);
const baseModel: RenderModel = summingAmpLayout.render!;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf: Buffer): DecodedPng {
  expect(buf.subarray(0, 8).equals(PNG_SIG)).toBe(true);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  let offset = 8;

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  expect(bitDepth).toBe(8);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  expect(bpp).toBeGreaterThan(0);

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const recon = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowStart + x]!;
      const a = x >= bpp ? recon[outStart + x - bpp]! : 0;
      const b = y > 0 ? recon[outStart - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? recon[outStart - stride + x - bpp]! : 0;
      let val = byte;
      if (filter === 1) val = (byte + a) & 0xff;
      else if (filter === 2) val = (byte + b) & 0xff;
      else if (filter === 3) val = (byte + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (byte + paeth(a, b, c)) & 0xff;
      recon[outStart + x] = val;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  if (bpp === 4) {
    rgba.set(recon);
  } else {
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i]!;
      rgba[j + 1] = recon[i + 1]!;
      rgba[j + 2] = recon[i + 2]!;
      rgba[j + 3] = 255;
    }
  }

  return { width, height, bitDepth, colorType, rgba };
}

function pixelAt(img: DecodedPng, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!, img.rgba[i + 3]!];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Expected 6-digit hex color, got ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

describe("render themes", () => {
  it("exposes all five SPEC 12.1 themes with complete definitions", () => {
    expect(THEME_NAMES).toEqual(["clean", "dark", "blueprint", "textbook", "mono-print"]);
    for (const id of THEME_NAMES) {
      const t = resolveTheme(id);
      expect(t).toEqual(THEMES[id]);
      expect(t.id).toBe(id);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.stroke).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(resolveTheme()).toEqual(THEMES.clean);
    expect(THEMES.clean.background).toBe("#ffffff");
    expect(THEMES.clean.stroke).toBe("#000000");
    expect(THEMES.clean.fill).toBe("#000000");
    expect(THEMES.clean.text).toBe("#000000");
  });

  it("keeps clean output 100% byte-for-byte identical to default toSvg and toPng", () => {
    const defaultSvg = toSvg(baseModel);
    expect(toSvg(baseModel, {})).toBe(defaultSvg);
    expect(toSvg(baseModel, { theme: "clean" })).toBe(defaultSvg);
    expect(toSvg(baseModel, { theme: "clean", transparent: false })).toBe(defaultSvg);

    const defaultPng = toPng(defaultSvg);
    expect(toPng(defaultSvg, 10)).toEqual(defaultPng);
    expect(toPng(defaultSvg, 10, {})).toEqual(defaultPng);
    expect(toPng(defaultSvg, 10, { transparent: false })).toEqual(defaultPng);
    expect(toPng(defaultSvg, 10, { background: "#ffffff" })).toEqual(defaultPng);
  });

  it.each(THEME_NAMES)("applies theme %s colours to SVG and PNG", (themeName: ThemeName) => {
    const theme = THEMES[themeName];
    const svg = toSvg(baseModel, { theme: themeName });

    expect(svg).toContain(`<rect `);
    expect(svg).toContain(`fill="${theme.background}"/>`);
    expect(svg).toContain(`<g fill="none" stroke="${theme.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`);
    expect(svg).toContain(`<g fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="2" stroke-linejoin="round">`);
    expect(svg).toContain(`<g fill="${theme.text}" stroke="none">`);

    const png = toPng(svg, 10);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(baseModel.bounds.w * 10);
    expect(decoded.height).toBe(baseModel.bounds.h * 10);

    const expectedBg = [...hexToRgb(theme.background), 255];
    expect(pixelAt(decoded, 0, 0)).toEqual(expectedBg);
    expect(pixelAt(decoded, decoded.width - 1, 0)).toEqual(expectedBg);
    expect(pixelAt(decoded, 0, decoded.height - 1)).toEqual(expectedBg);
    expect(pixelAt(decoded, decoded.width - 1, decoded.height - 1)).toEqual(expectedBg);
  });

  it("omits background rect and preserves alpha transparency when transparent is true", () => {
    for (const themeName of ["clean", "dark"] as const) {
      const svg = toSvg(baseModel, { theme: themeName, transparent: true });
      expect(svg).not.toContain("<rect ");

      const pngViaFlag = toPng(svg, 10, { transparent: true });
      const pngViaNull = toPng(svg, 10, { background: null });
      expect(pngViaFlag.equals(pngViaNull)).toBe(true);

      const decoded = decodePng(pngViaFlag);
      expect(decoded.colorType).toBe(6); // RGBA
      expect(pixelAt(decoded, 0, 0)[3]).toBe(0);
      expect(pixelAt(decoded, decoded.width - 1, decoded.height - 1)[3]).toBe(0);

      // Verify drawn ink pixels are opaque
      let opaquePixels = 0;
      for (let i = 3; i < decoded.rgba.length; i += 4) {
        if (decoded.rgba[i]! === 255) opaquePixels++;
      }
      expect(opaquePixels).toBeGreaterThan(100);
    }
  });

  it("supports an explicit PNG background override on transparent SVGs", () => {
    const svg = toSvg(baseModel, { theme: "dark", transparent: true });
    const png = toPng(svg, 10, { background: "#112233" });
    const decoded = decodePng(png);
    expect(pixelAt(decoded, 0, 0)).toEqual([0x11, 0x22, 0x33, 255]);
  });

  it("falls back to renderModel.meta.theme and lets options.theme override it", () => {
    const modelWithTheme: RenderModel = {
      ...baseModel,
      meta: { ...baseModel.meta, theme: "blueprint" },
    };
    expect(toSvg(modelWithTheme)).toBe(toSvg(baseModel, { theme: "blueprint" }));
    expect(toSvg(modelWithTheme, { theme: "textbook" })).toBe(toSvg(baseModel, { theme: "textbook" }));
  });

  it("throws a clear error listing valid themes for unknown theme names", () => {
    for (const bad of ["neon", "", "DARK", "toString", "constructor"]) {
      expect(() => resolveTheme(bad)).toThrow(/Unknown theme/);
      for (const valid of THEME_NAMES) {
        expect(() => resolveTheme(bad)).toThrow(new RegExp(valid));
      }
      expect(() => toSvg(baseModel, { theme: bad })).toThrow(/Unknown theme/);
    }
    const badMetaModel: RenderModel = { ...baseModel, meta: { theme: "missing" } };
    expect(() => toSvg(badMetaModel)).toThrow(/Unknown theme "missing"/);
  });

  it("produces byte-for-byte deterministic SVG and PNG output across repeated runs", () => {
    for (const themeName of THEME_NAMES) {
      const svg1 = toSvg(baseModel, { theme: themeName });
      const svg2 = toSvg(baseModel, { theme: themeName });
      expect(svg2).toBe(svg1);

      const png1 = toPng(svg1, 10);
      const png2 = toPng(svg2, 10);
      expect(png2.equals(png1)).toBe(true);
    }

    const tSvg1 = toSvg(baseModel, { theme: "dark", transparent: true });
    const tSvg2 = toSvg(baseModel, { theme: "dark", transparent: true });
    expect(tSvg2).toBe(tSvg1);
    expect(toPng(tSvg1, 10, { transparent: true }).equals(toPng(tSvg2, 10, { transparent: true }))).toBe(true);
  });
});
