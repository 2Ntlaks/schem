// Rasterise baseline SVGs to PNG with the repo's own @resvg/resvg-js, identical settings for every tool:
// white background; the view box set to the drawn content (text included) plus 4 % of its longer side on every
// edge (netlistsvg sizes its canvas to the symbols and clips labels that stick out); the longer side scaled
// to 1600 px; fonts = the repo's DejaVu set only (no system fonts), so every tool's text is drawn with the
// same faces.
// Usage: node baselines/scripts/rasterize.mjs in.svg out.png [more pairs...]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(REPO, "package.json"));
const { Resvg } = require("@resvg/resvg-js");
const TTF = join(REPO, "node_modules", "dejavu-fonts-ttf", "ttf");
export const LONG_SIDE = 1600;
export const PAD = 0.04;
const OPTIONS = {
  background: "#ffffff",
  font: {
    loadSystemFonts: false,
    fontFiles: ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSerif.ttf"].map((f) => join(TTF, f)),
    defaultFontFamily: "DejaVu Sans",
    sansSerifFamily: "DejaVu Sans",
    serifFamily: "DejaVu Serif",
    monospaceFamily: "DejaVu Sans Mono",
  },
};

/** Set the root view box to the drawn content's bounding box (text included, as resvg measures it), padded
 *  by PAD of its longer side. Returns the new SVG text and whether it is wider than tall. */
export function pad(svg) {
  const m = /<svg\s[^>]*>/.exec(svg);
  if (!m) throw new Error("no <svg> root");
  let tag = m[0];
  const re = (n) => new RegExp(`\\s${n}="([^"]*)"`);
  const attr = (n) => re(n).exec(tag)?.[1];
  const unit = (v) => (v ?? "").replace(/^[-\d.]+/, "");
  const wA = attr("width"), hA = attr("height");
  const [, , w0, h0] = (attr("viewBox") ?? `0 0 ${parseFloat(wA)} ${parseFloat(hA)}`).trim().split(/[\s,]+/).map(Number);
  const sx = wA ? parseFloat(wA) / w0 : 1, sy = hA ? parseFloat(hA) / h0 : 1;
  const b = new Resvg(svg, OPTIONS).getBBox();
  const [x, y, w, h] = b ? [b.x, b.y, b.width, b.height] : [0, 0, w0, h0];
  const p = PAD * Math.max(w, h);
  const set = (n, v) => { tag = re(n).test(tag) ? tag.replace(re(n), ` ${n}="${v}"`) : tag.replace(/^<svg/, `<svg ${n}="${v}"`); };
  set("viewBox", `${x - p} ${y - p} ${w + 2 * p} ${h + 2 * p}`);
  set("width", `${((w + 2 * p) * sx).toFixed(3)}${unit(wA)}`);
  set("height", `${((h + 2 * p) * sy).toFixed(3)}${unit(hA)}`);
  return { svg: svg.replace(m[0], tag), wide: w >= h };
}

export function rasterize(svgPath, pngPath) {
  const { svg, wide } = pad(readFileSync(svgPath, "utf8"));
  const fitTo = { mode: wide ? "width" : "height", value: LONG_SIDE };
  const png = new Resvg(svg, { ...OPTIONS, fitTo }).render().asPng();
  writeFileSync(pngPath, png);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2);
  if (a.length < 2 || a.length % 2) { console.error("usage: rasterize.mjs in.svg out.png [...]"); process.exit(2); }
  for (let i = 0; i < a.length; i += 2) { rasterize(a[i], a[i + 1]); console.log(`${a[i + 1]}`); }
}
