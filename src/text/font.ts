// Bundled font, measurement and outlining (SPEC 12.2). The same glyph positions
// are used for measuring and drawing. Phase 0a uses DejaVu Sans (free licence,
// shipped via the dejavu-fonts-ttf package); the final font is chosen later.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);
export const FONT_PATH = require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");

let font: opentype.Font | undefined;
let fontHash = "";

function load(): opentype.Font {
  if (!font) {
    const buf = readFileSync(FONT_PATH);
    fontHash = createHash("sha256").update(buf).digest("hex");
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return font;
}

export function fontId(): string { load(); return `DejaVuSans@sha256:${fontHash.slice(0, 16)}`; }

export interface TextBox { width: number; ascent: number; descent: number }

/** Size in SVG units. Missing glyphs are an error (SPEC 12.2), never a silent fallback. */
export function measure(text: string, size: number): TextBox {
  const f = load();
  for (const ch of text) {
    if (f.charToGlyphIndex(ch) === 0) throw new Error(`the font has no glyph for "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()}) in label "${text}"`);
  }
  const scale = size / f.unitsPerEm;
  return { width: f.getAdvanceWidth(text, size, { kerning: true }), ascent: f.ascender * scale, descent: -f.descender * scale };
}

/** SVG path data for `text` with its alphabetic baseline at (x, y), in SVG units. */
export function outline(text: string, x: number, y: number, size: number): string {
  return load().getPath(text, x, y, size, { kerning: true }).toPathData(2);
}
