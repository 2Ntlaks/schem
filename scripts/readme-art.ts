// Draw the README hero image, docs/assets/hero.png: an example circuit file on the left and the
// drawing schem makes from it on the right.
//
// Usage: npm run readme:art
//
// Nothing in the picture is mocked up. The file text is the example file itself (every field but
// `meta`, one item per line; the script checks it parses back to the same data), the drawing is laid
// out and rendered by the engine when this runs, and the status line comes from checkDrawing.

import { Resvg } from "@resvg/resvg-js";
import { isDeepStrictEqual } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXAMPLE = "examples/summing-amp.schem.json";
const OUT = path.join(ROOT, "docs", "assets", "hero.png");
const TTF = path.join(ROOT, "node_modules", "dejavu-fonts-ttf", "ttf");

const C = {
  paper: "#f6f3ec", rule: "#e3ddcf", dot: "#d8d1c1",
  code: "#1b2230", codeRule: "#2a3344", plain: "#d5dde9", key: "#8fb2f0", str: "#e9c07f", punct: "#76829a",
  ink: "#182a38", muted: "#6f7a86", accent: "#bf5238", ok: "#2f7a4f",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// The file text: the example's data, one part or net per line, long nets wrapped after the name.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
/** One-line JSON with a space after colons and commas, and inside object braces. */
function compact(v: Json): string {
  if (Array.isArray(v)) return `[${v.map(compact).join(", ")}]`;
  if (v !== null && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${compact(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

function fileLines(doc: { [k: string]: Json }): string[] {
  const circuit = doc.circuit as { parts: Json[]; nets: { [k: string]: Json }[] };
  const lines = ["{", `  "schema": ${JSON.stringify(doc.schema)},`, `  "circuit": {`, `    "parts": [`];
  circuit.parts.forEach((p, i) => lines.push(`      ${compact(p)}${i < circuit.parts.length - 1 ? "," : ""}`));
  lines.push("    ],", `    "nets": [`);
  circuit.nets.forEach((n, i) => {
    const end = i < circuit.nets.length - 1 ? "," : "";
    const one = `      ${compact(n)}${end}`;
    if (one.length <= 64) { lines.push(one); return; }
    const { endpoints, ...head } = n;
    lines.push(`      ${compact(head).replace(/ \}$/, ",")}`, `        "endpoints": ${compact(endpoints!)} }${end}`);
  });
  lines.push("    ]", "  }", "}");
  return lines;
}

/** Colour a line of JSON: keys, strings and punctuation. */
function tspans(line: string): string {
  const out: string[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],:])|([^"{}[\],:]+)/g;
  for (const m of line.matchAll(re)) {
    if (m[1]) {
      out.push(`<tspan fill="${m[2] ? C.key : C.str}">${esc(m[1])}</tspan>`);
      if (m[2]) out.push(`<tspan fill="${C.punct}">${esc(m[2])}</tspan>`);
    } else if (m[3]) out.push(`<tspan fill="${C.punct}">${esc(m[3])}</tspan>`);
    else out.push(`<tspan fill="${C.plain}">${esc(m[4]!)}</tspan>`);
  }
  return out.join("");
}

// ---------------------------------------------------------------------------

const raw = readFileSync(path.join(ROOT, EXAMPLE), "utf8");
const doc = JSON.parse(raw) as { [k: string]: Json };
const lines = fileLines(doc);
const { meta: _meta, ...shown } = doc;
if (!isDeepStrictEqual(JSON.parse(lines.join("\n")), shown)) throw new Error("the file text in the picture does not match the example");

const loaded = readProject(path.join(ROOT, EXAMPLE));
if (!loaded.ok || !loaded.project) throw new Error(`cannot load ${EXAMPLE}`);
const result = layout(loaded.project);
if (!result.render) throw new Error(`cannot lay out ${EXAMPLE}`);
const q = checkDrawing(loaded.project.circuit, result.pinDefs, result.render);
if (!q.valid || result.status !== "valid") throw new Error(`${EXAMPLE} does not draw valid; the hero would lie`);
const drawing = toSvg(result.render);
const vb = /viewBox="([^"]+)"/.exec(drawing)![1]!;
const [, , vw, vh] = vb.split(/\s+/).map(Number) as [number, number, number, number];
const inner = drawing.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/, "");

// Geometry (CSS px; rendered at 2x).
const PAD = 28, FONT = 12, LH = 16.5, CHAR = FONT * 0.602;
const codeW = Math.ceil(Math.max(...lines.map((l) => l.length)) * CHAR) + 40;
const codeH = 46 + lines.length * LH + 18;
const gap = 100;
const sheetW = 580, sheetH = Math.round(sheetW * vh / vw) + 36;
const W = PAD + codeW + gap + sheetW + PAD;
const bodyH = Math.max(codeH, sheetH + 44);
const H = PAD + bodyH + PAD;
const codeX = PAD, codeY = PAD + (bodyH - codeH) / 2;
const sheetX = PAD + codeW + gap, sheetY = PAD + (bodyH - sheetH - 44) / 2;
const midY = PAD + bodyH / 2;
const ax0 = codeX + codeW + 18, ax1 = sheetX - 18;

const okY = sheetY + sheetH + 30;
const okText = `valid  ·  every connection checked  ·  ${q.overlaps.length} overlaps`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1" fill="${C.dot}"/></pattern>
</defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="22" fill="${C.paper}" stroke="${C.rule}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="22" fill="url(#grid)"/>

<rect x="${codeX}" y="${codeY}" width="${codeW}" height="${codeH}" rx="14" fill="${C.code}"/>
<text x="${codeX + 20}" y="${codeY + 26}" font-family="DejaVu Sans Mono" font-size="11.5" fill="${C.punct}">${esc(EXAMPLE)}</text>
<line x1="${codeX}" y1="${codeY + 40}" x2="${codeX + codeW}" y2="${codeY + 40}" stroke="${C.codeRule}"/>
<g font-family="DejaVu Sans Mono" font-size="${FONT}" xml:space="preserve">
${lines.map((l, i) => `<text x="${codeX + 20}" y="${codeY + 46 + 14 + i * LH}">${tspans(l)}</text>`).join("\n")}
</g>

<g stroke="${C.accent}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M${ax0} ${midY} H${ax1 - 2}"/>
  <path d="M${ax1 - 10} ${midY - 7} L${ax1} ${midY} L${ax1 - 10} ${midY + 7}"/>
</g>
<text x="${(ax0 + ax1) / 2}" y="${midY - 14}" text-anchor="middle" font-family="DejaVu Sans Mono" font-weight="bold" font-size="12.5" fill="${C.accent}">schem draw</text>
<text x="${(ax0 + ax1) / 2}" y="${midY + 24}" text-anchor="middle" font-family="DejaVu Sans" font-size="10.5" fill="${C.muted}">place</text>
<text x="${(ax0 + ax1) / 2}" y="${midY + 38}" text-anchor="middle" font-family="DejaVu Sans" font-size="10.5" fill="${C.muted}">route</text>
<text x="${(ax0 + ax1) / 2}" y="${midY + 52}" text-anchor="middle" font-family="DejaVu Sans" font-size="10.5" fill="${C.muted}">verify</text>

<rect x="${sheetX + 3}" y="${sheetY + 5}" width="${sheetW}" height="${sheetH}" rx="10" fill="#000" fill-opacity="0.06"/>
<rect x="${sheetX}" y="${sheetY}" width="${sheetW}" height="${sheetH}" rx="10" fill="#ffffff" stroke="${C.rule}"/>
<svg x="${sheetX + 18}" y="${sheetY + 18}" width="${sheetW - 36}" height="${sheetH - 36}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${inner}</svg>

<g transform="translate(${sheetX + 6} ${okY - 9})"><circle cx="7" cy="5" r="8" fill="${C.ok}"/><path d="M3.2 5.2 L6 8 L11 2.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>
<text x="${sheetX + 24}" y="${okY}" font-family="DejaVu Sans" font-size="12.5" fill="${C.ink}">${esc(okText)}</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "zoom", value: 2 },
  font: {
    loadSystemFonts: false,
    fontFiles: ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"].map((f) => path.join(TTF, f)),
    defaultFontFamily: "DejaVu Sans",
    monospaceFamily: "DejaVu Sans Mono",
  },
}).render().asPng();
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${path.relative(ROOT, OUT)} (${W * 2}x${H * 2}, ${Math.round(png.length / 1024)} KB)`);
