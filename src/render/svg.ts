// Render model -> SVG (SPEC 12.3): self-contained, presentation attributes only,
// text outlined, deterministic output.

import { measure, outline } from "../text/font.js";
import type { RenderModel } from "./model.js";
import { resolveTheme, type ThemeName } from "./themes.js";

const STROKE = 2; // 0.2 G at 10 units per G

export interface SvgOptions {
  theme?: ThemeName | string;
  transparent?: boolean;
}

export function toSvg(m: RenderModel, options?: SvgOptions): string {
  const theme = resolveTheme(options?.theme ?? m.meta.theme ?? "clean");
  const b = m.bounds;
  const vb = [b.x * 10, b.y * 10, b.w * 10, b.h * 10].map(fmt).join(" ");
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(b.w * 2.54)}mm" height="${fmt(b.h * 2.54)}mm" viewBox="${vb}">`);
  if (m.meta.title) out.push(`<title>${esc(m.meta.title)}</title>`);
  if (!options?.transparent) {
    out.push(`<rect x="${fmt(b.x * 10)}" y="${fmt(b.y * 10)}" width="${fmt(b.w * 10)}" height="${fmt(b.h * 10)}" fill="${theme.background}"/>`);
  }
  out.push(`<g fill="none" stroke="${theme.stroke}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">`);
  for (const a of m.art) if (a.t === "path" && a.fill !== "stroke") out.push(`<path d="${a.d}"/>`);
  out.push(`</g>`);
  out.push(`<g fill="${theme.fill}" stroke="${theme.stroke}" stroke-width="${STROKE}" stroke-linejoin="round">`);
  for (const a of m.art) if (a.t === "path" && a.fill === "stroke") out.push(`<path d="${a.d}"/>`);
  out.push(`</g>`);
  out.push(`<g fill="${theme.text}" stroke="none">`);
  for (const a of m.art) {
    if (a.t !== "text") continue;
    const tb = measure(a.text, a.size);
    const x = a.x * 10 - (a.anchor === "middle" ? tb.width / 2 : a.anchor === "end" ? tb.width : 0);
    const y = a.y * 10 + (a.baseline === "top" ? tb.ascent * 0.8 : a.baseline === "middle" ? (tb.ascent * 0.8) / 2 : 0);
    out.push(`<path aria-label="${esc(a.text)}" d="${outline(a.text, round(x), round(y), a.size)}"/>`);
  }
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

function round(n: number): number { return Math.round(n * 100) / 100; }
function fmt(n: number): string { const v = round(n); return String(Object.is(v, -0) ? 0 : v); }
function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
