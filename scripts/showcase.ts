// Build the comparison showcase in docs/showcase.
//
// Usage: npm run showcase   (from the repo root)
//
// Copies the seven chosen validation circuits into docs/showcase/img/ (ours from out/phase0/validation,
// each baseline tool from baselines/out/<tool>/validation/caseNN/final.png). Baseline files are copied as
// they are; ours are rasterised from the phase0 SVG by the baselines' own rasteriser. Then it writes docs/showcase/comparison.png plus docs/showcase/index.html.
// A tool that has no passing drawing for a case (tscircuit cases 5 and 7) gets a text cell, not an image.
//
// comparison.png is built as an SVG that embeds the PNGs and is rasterised with @resvg/resvg-js, the
// same renderer the engine uses (src/render/png.ts). Text uses the repo's DejaVu fonts so the image does
// not depend on fonts installed on the machine.
import { Resvg } from "@resvg/resvg-js";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: plain JS module without types; rasterize(svgPath, pngPath) writes the PNG.
import { rasterize } from "../baselines/scripts/rasterize.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = path.join(ROOT, "docs", "showcase");
const IMG = path.join(OUT, "img");
const PHASE0 = path.join(ROOT, "out", "phase0", "validation");
const BASELINES = path.join(ROOT, "baselines", "out");
const FONT_DIR = path.join(ROOT, "node_modules", "dejavu-fonts-ttf", "ttf");

type ToolKey = "schem" | "tscircuit" | "skidl" | "netlistsvg" | "schemdraw";

interface Tool {
  key: ToolKey;
  label: string;
  dir: string | null;
}

interface Circuit {
  n: number;
  file: string;
  name: string;
  lines: string[];
  parts: string;
}

// Cases chosen for the showcase (SPEC 15 / Part B).
const CIRCUITS: Circuit[] = [
  {
    n: 1,
    file: "case01-led.png",
    name: "LED and resistor",
    lines: ["LED and resistor"],
    parts: "B1 9 V battery, R1 470, D1 red LED.",
  },
  {
    n: 3,
    file: "case03-summing.png",
    name: "Op-amp summing amplifier",
    lines: ["Op-amp summing", "amplifier"],
    parts: "V1 1 V, V2 0.5 V, V3 0.2 V, R1-R3 10k, Rf 20k, RL 2.2k, U1 op-amp.",
  },
  {
    n: 4,
    file: "case04-hbridge.png",
    name: "H-bridge motor driver",
    lines: ["H-bridge motor", "driver"],
    parts: "B1 12 V, Q1-Q4 IRF540N, R1-R4 100, R5-R8 10k, M1 12 V motor, J1 drive header.",
  },
  {
    n: 5,
    file: "case05-i2c.png",
    name: "I2C sensors",
    lines: ["I2C sensors"],
    parts: "U1 ESP32-DevKitC, U2 BME280, U3 SHT31, R1 and R2 4.7k pull-ups.",
  },
  {
    n: 6,
    file: "case06-esp32-relay.png",
    name: "ESP32 relay",
    lines: ["ESP32 relay"],
    parts: "U1 ESP32-DevKitC V4, K1 5 V relay, Q1 2N2222A, D1 1N4148, R1 1k, R2 10k, J1 load header.",
  },
  {
    n: 7,
    file: "case07-two-ic-decoupling.png",
    name: "Two ICs with decoupling",
    lines: ["Two ICs with", "decoupling"],
    parts: "U1 ATmega328P, U2 24LC256, C1-C4, R1 10k, R2 and R3 4.7k, J1 5 V input.",
  },
  {
    n: 8,
    file: "case08-diffpair.png",
    name: "Differential pair",
    lines: ["Differential pair"],
    parts: "V1 1 mV, V2 and V3 12 V, Q1 and Q2 2N3904, Q3 and Q4 2N3906, RE 11k, RL 10k.",
  },
];

const TOOLS: Tool[] = [
  { key: "schem", label: "schem (ours)", dir: null },
  { key: "tscircuit", label: "tscircuit", dir: "tscircuit" },
  { key: "skidl", label: "SKiDL", dir: "skidl" },
  { key: "netlistsvg", label: "netlistsvg", dir: "netlistsvg" },
  { key: "schemdraw", label: "schemdraw", dir: "schemdraw" },
];

const FAILURE_CAPTION = "tool failure, see notes";

// tscircuit has no final for these cases: every attempt failed the harness's connection check. The cell
// carries the reason as text instead of a drawing; no failing attempt is shown.
const NO_FINAL = new Set(["tscircuit-5", "tscircuit-7"]);
const NO_FINAL_TEXT = "no drawing passed the connection check (see notes)";

function caseDir(n: number): string {
  return `case${String(n).padStart(2, "0")}`;
}

function pngSize(buf: Buffer, label: string): { w: number; h: number } {
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${label} is not a PNG file`);
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function num(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

async function copyImages(): Promise<Map<string, { buf: Buffer; w: number; h: number }>> {
  const phase0 = (await readdir(PHASE0)).filter((f) => f.endsWith(".png"));
  const images = new Map<string, { buf: Buffer; w: number; h: number }>();
  const missing: string[] = [];

  for (const c of CIRCUITS) {
    for (const t of TOOLS) {
      if (NO_FINAL.has(`${t.key}-${c.n}`)) continue;
      let from: string;
      if (t.dir === null) {
        if (!phase0.includes(c.file)) {
          missing.push(path.join("out", "phase0", "validation", c.file));
          continue;
        }
        from = path.join(PHASE0, c.file);
      } else {
        from = path.join(BASELINES, t.dir, "validation", caseDir(c.n), "final.png");
        if (!existsSync(from)) {
          missing.push(from);
          continue;
        }
      }
      // Ours: the same phase0 drawing, rasterised from its SVG by the baselines' own rasteriser (same
      // padding, 1600 px long side, same fonts), so every cell and click-through compares like with like.
      const to = path.join(IMG, `${caseDir(c.n)}-${t.key}.png`);
      if (t.dir === null) rasterize(from.replace(/\.png$/, ".svg"), to);
      else await copyFile(from, to);
      const buf = await readFile(to);
      images.set(`${c.n}-${t.key}`, { buf, ...pngSize(buf, from) });
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.length} drawing(s); run "npm run phase0" and the baseline attempts first:\n  ${missing.join("\n  ")}`,
    );
  }
  return images;
}

function cellCaption(t: Tool, c: Circuit): string | null {
  // A drawing that passes the check can still be a tool failure: the tool did not draw the whole circuit.
  if (t.key === "skidl" && c.n === 7) return FAILURE_CAPTION;
  if (t.key === "tscircuit" && c.n === 4) return FAILURE_CAPTION;
  return null;
}

function comparisonSvg(images: Map<string, { buf: Buffer; w: number; h: number }>): string {
  const M = 46;
  const LABEL_W = 196;
  const CELL_W = 468;
  const CELL_H = 330;
  const GAP = 22;
  const ROW_GAP = 22;
  const X0 = M + LABEL_W + 14;
  const WIDTH = X0 + TOOLS.length * CELL_W + (TOOLS.length - 1) * GAP + M;
  const TOP = 172;
  const ROWS_H = CIRCUITS.length * CELL_H + (CIRCUITS.length - 1) * ROW_GAP;
  const FOOT_RULE = TOP + ROWS_H + 24;
  const HEIGHT = FOOT_RULE + 106;

  const ink = "#182a38";
  const muted = "#66747d";
  const line = "#e3dbcf";
  const accent = "#bf5238";

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`);
  parts.push(`<text x="${M}" y="56" font-family="DejaVu Sans" font-weight="bold" font-size="36" fill="${ink}">Seven circuits, five drawings each</text>`);
  parts.push(
    `<text x="${M}" y="88" font-family="DejaVu Sans" font-size="17" fill="${muted}">The same netlist drawn by our engine, tscircuit, SKiDL, netlistsvg and schemdraw. Validation cases 1, 3, 4, 5, 6, 7 and 8.</text>`,
  );

  TOOLS.forEach((t, i) => {
    const cx = X0 + i * (CELL_W + GAP);
    parts.push(
      `<text x="${num(cx + CELL_W / 2)}" y="138" font-family="DejaVu Sans" font-weight="bold" font-size="19" fill="${ink}" text-anchor="middle">${esc(t.label)}</text>`,
    );
  });
  parts.push(`<line x1="${M}" y1="152" x2="${num(WIDTH - M)}" y2="152" stroke="${line}" stroke-width="1.5"/>`);

  CIRCUITS.forEach((c, r) => {
    const y = TOP + r * (CELL_H + ROW_GAP);
    const labelH = 20 + c.lines.length * 26;
    const labelTop = y + (CELL_H - labelH) / 2;
    parts.push(
      `<text x="${M}" y="${num(labelTop + 14)}" font-family="DejaVu Sans" font-weight="bold" font-size="12.5" letter-spacing="1.6" fill="${accent}">CASE ${c.n}</text>`,
    );
    c.lines.forEach((ln, i) => {
      parts.push(
        `<text x="${M}" y="${num(labelTop + 42 + i * 26)}" font-family="DejaVu Sans" font-weight="bold" font-size="20" fill="${ink}">${esc(ln)}</text>`,
      );
    });

    TOOLS.forEach((t, i) => {
      const x = X0 + i * (CELL_W + GAP);
      const img = images.get(`${c.n}-${t.key}`);
      parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${CELL_W}" height="${CELL_H}" rx="10" fill="#ffffff" stroke="${line}" stroke-width="1.5"/>`);
      if (img === undefined) {
        if (!NO_FINAL.has(`${t.key}-${c.n}`)) throw new Error(`no image for case ${c.n}, ${t.label}`);
        const tx = x + CELL_W / 2;
        const ty = y + CELL_H / 2;
        parts.push(
          `<text x="${num(tx)}" y="${num(ty - 10)}" font-family="DejaVu Sans" font-size="15" fill="${muted}" text-anchor="middle">no drawing passed</text>`,
          `<text x="${num(tx)}" y="${num(ty + 12)}" font-family="DejaVu Sans" font-size="15" fill="${muted}" text-anchor="middle">the connection check</text>`,
          `<text x="${num(tx)}" y="${num(ty + 34)}" font-family="DejaVu Sans" font-size="15" fill="${muted}" text-anchor="middle">(see notes)</text>`,
        );
        return;
      }
      const href = `data:image/png;base64,${img.buf.toString("base64")}`;
      parts.push(
        `<image x="${num(x + 10)}" y="${num(y + 10)}" width="${CELL_W - 20}" height="${CELL_H - 42}" preserveAspectRatio="xMidYMid meet" href="${href}"/>`,
      );
      const caption = cellCaption(t, c);
      if (caption !== null) {
        parts.push(
          `<text x="${num(x + CELL_W / 2)}" y="${num(y + CELL_H - 12)}" font-family="DejaVu Sans" font-size="13" fill="${accent}" text-anchor="middle">${caption}</text>`,
        );
      }
    });
  });

  parts.push(`<line x1="${M}" y1="${num(FOOT_RULE)}" x2="${num(WIDTH - M)}" y2="${num(FOOT_RULE)}" stroke="${line}" stroke-width="1.5"/>`);
  parts.push(
    `<text x="${M}" y="${num(FOOT_RULE + 28)}" font-family="DejaVu Sans" font-size="15" fill="${muted}">Each cell is scaled to fit the same box, so the drawing scales differ. SKiDL case 7 and tscircuit case 4 are marked as tool failures.</text>`,
  );
  parts.push(
    `<text x="${M}" y="${num(FOOT_RULE + 50)}" font-family="DejaVu Sans" font-size="15" fill="${muted}">tscircuit has no drawing in cases 5 and 7 because every attempt failed the connection check; those cells carry the reason instead.</text>`,
  );
  parts.push(
    `<text x="${M}" y="${num(FOOT_RULE + 72)}" font-family="DejaVu Sans" font-size="15" fill="${muted}">tscircuit does not print battery voltages or diode and transistor part numbers; that is the tool, not the converter.</text>`,
  );
  parts.push(`</svg>`);
  return parts.join("\n");
}

function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    background: "#ffffff",
    font: {
      fontFiles: [path.join(FONT_DIR, "DejaVuSans.ttf"), path.join(FONT_DIR, "DejaVuSans-Bold.ttf")],
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
    },
  });
  return resvg.render().asPng();
}

function figure(c: Circuit, t: Tool, images: Map<string, { buf: Buffer; w: number; h: number }>): string {
  const img = images.get(`${c.n}-${t.key}`);
  const src = `img/${caseDir(c.n)}-${t.key}.png`;
  const alt = `Case ${c.n}, ${c.name}, drawn by ${t.label}`;
  let body: string;
  if (img === undefined) {
    if (!NO_FINAL.has(`${t.key}-${c.n}`)) throw new Error(`no image for case ${c.n}, ${t.label}`);
    body = `\n        <p class="no-final">${NO_FINAL_TEXT}</p>`;
  } else {
    body = `\n        <a href="${src}"><img src="${src}" alt="${esc(alt)}" width="${img.w}" height="${img.h}"></a>`;
  }
  const failure =
    t.key === "skidl" && c.n === 7
      ? `\n        <p class="failure">Tool failure: the passives are stacked behind U1, so only the two ICs are visible. See the note below.</p>`
      : t.key === "tscircuit" && c.n === 4
        ? `\n        <p class="failure">Tool failure: Q3's symbol is not drawn; tscircuit prints an error in its place. See the note below.</p>`
        : "";
  return `      <figure class="cell">
        <figcaption class="tool">${esc(t.label)}</figcaption>${body}${failure}
      </figure>`;
}

function htmlPage(images: Map<string, { buf: Buffer; w: number; h: number }>): string {
  const sections = CIRCUITS.map((c) => {
    const figs = TOOLS.map((t) => figure(c, t, images)).join("\n");
    return `    <article class="circuit" id="case-${c.n}">
      <header class="circuit-head">
        <p class="case-no">Case ${c.n}</p>
        <h3>${esc(c.name)}</h3>
        <p class="parts">${esc(c.parts)}</p>
      </header>
      <div class="grid">
${figs}
      </div>
    </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Five ways to draw the same circuit</title>
  <meta name="description" content="The same seven validation circuits drawn by schem, tscircuit, SKiDL, netlistsvg and schemdraw.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --paper: #f7f3ec;
      --card: #fffdf9;
      --ink: #182a38;
      --soft: #3c4c58;
      --muted: #66747d;
      --line: #e3dbcf;
      --accent: #bf5238;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 400 17px/1.62 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    h1, h2, h3 {
      font-family: "Fraunces", Georgia, "Times New Roman", serif;
      font-weight: 600;
      line-height: 1.14;
      letter-spacing: -0.01em;
      margin: 0;
    }
    main { max-width: 1720px; margin: 0 auto; padding: clamp(20px, 4vw, 56px); }
    a { color: var(--accent); text-underline-offset: 2px; }
    code { font-family: "IBM Plex Mono", ui-monospace, "Cascadia Mono", monospace; font-size: 0.92em; background: #efe9df; padding: 0.1em 0.32em; border-radius: 4px; }
    .hero { max-width: 820px; padding: clamp(8px, 3vw, 36px) 0 8px; }
    .eyebrow {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--accent);
    }
    h1 { font-size: clamp(35px, 5.2vw, 66px); }
    .lede { font-size: clamp(17px, 1.45vw, 21px); color: var(--soft); max-width: 64ch; margin: 18px 0 0; }
    section { margin-top: clamp(34px, 5vw, 66px); }
    h2 { font-size: clamp(24px, 2.5vw, 34px); margin-bottom: 0.6em; }
    .tool-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 16px;
    }
    .tool-list li {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px 20px;
      font-size: 15px;
      line-height: 1.55;
      color: var(--soft);
    }
    .tool-list strong {
      display: block;
      font-family: "Fraunces", Georgia, serif;
      font-size: 19px;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 4px;
    }
    .fairness {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 5px solid var(--accent);
      border-radius: 14px;
      padding: clamp(20px, 3vw, 36px);
      max-width: 1080px;
    }
    .fairness h2 { margin-top: 0; }
    .fairness ul { margin: 0; padding-left: 1.15em; }
    .fairness li + li { margin-top: 0.55em; }
    .hint { color: var(--muted); font-size: 14.5px; margin: 0 0 6px; }
    .circuit { margin-top: 34px; border-top: 1px solid var(--line); padding-top: 22px; }
    .circuit-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
    .case-no {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .circuit h3 { font-size: clamp(21px, 2vw, 27px); }
    .parts { flex-basis: 100%; margin: 2px 0 0; color: var(--muted); font-size: 14.5px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 18px;
      margin-top: 16px;
      align-items: stretch;
    }
    .cell {
      margin: 0;
      min-width: 0;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 10px 12px;
      display: flex;
      flex-direction: column;
    }
    .tool {
      margin: 2px 4px 8px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .cell a { display: flex; flex: 1; align-items: center; justify-content: center; min-height: 120px; }
    .cell img { display: block; max-width: 100%; height: auto; }
    .failure { margin: 10px 4px 0; font-size: 13px; line-height: 1.45; color: var(--accent); }
    .no-final {
      margin: 0;
      padding: 18px 14px;
      align-self: center;
      text-align: center;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.5;
    }
    .notes { max-width: 940px; }
    .notes h3 { font-size: clamp(19px, 1.8vw, 24px); margin: 26px 0 8px; }
    .notes p { color: var(--soft); margin: 0; }
    footer {
      max-width: 1720px;
      margin: 56px auto 0;
      padding: 24px clamp(20px, 4vw, 56px) 56px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 1180px) {
      .tool-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 600px) {
      .tool-list { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; gap: 14px; }
      .cell a { min-height: 0; }
    }
  </style>
</head>
<body>
<main>
  <header class="hero">
    <p class="eyebrow">schem showcase</p>
    <h1>Five ways to draw the same circuit</h1>
    <p class="lede">Seven validation circuits, each drawn from the same netlist by our engine and by four open-source tools. This page shows the same grid as <a href="comparison.png">comparison.png</a> and links every drawing to its original PNG.</p>
  </header>

  <section>
    <h2>The five tools</h2>
    <ul class="tool-list">
      <li><strong>schem (ours)</strong>This project's engine. It takes a netlist in JSON, lays the schematic out itself, and writes SVG and PNG. The seven drawings here are the SVGs that <code>npm run phase0</code> produced, rasterised with the same settings as the baselines (1600 px on the long side, same fonts).</li>
      <li><strong>tscircuit</strong>A TypeScript library that describes a circuit in code and lays out its schematic automatically. These drawings come from <code>@tscircuit/core</code>'s circuit JSON, rendered by <code>circuit-to-svg</code>.</li>
      <li><strong>SKiDL</strong>A Python library for describing circuits in code. Its schematic generator places the parts and routes the wires automatically. The baseline harness falls back to SKiDL's label mode when its router fails.</li>
      <li><strong>netlistsvg</strong>A JavaScript tool that lays out a Yosys-style netlist with the ELK graph library and draws it with a replaceable skin. These drawings use the analog skin that ships with the tool.</li>
      <li><strong>schemdraw</strong>A Python drawing library. Every symbol, label and wire is placed by code, so these seven drawings were written by hand, while the other four tools, ours included, lay out the drawing automatically.</li>
    </ul>
  </section>

  <section class="fairness">
    <h2>How this was made fairly</h2>
    <ul>
      <li>schemdraw is drawn by hand, one Python file per circuit. schem, tscircuit, SKiDL and netlistsvg are automatic: they take the netlist and place and route the drawing themselves.</li>
      <li>Each baseline tool had one first attempt plus at most three revisions per circuit. Every attempt is logged in <a href="../../baselines/LOG.md">baselines/LOG.md</a>, with what changed and why.</li>
      <li>The chosen drawing for each tool and circuit is the attempt with the fewest drawing errors among those whose connection check passes. Known defects in the chosen drawings are listed in the same log.</li>
      <li>Some baselines shorten long part names to fit the drawing, for example <code>U1 ESP32</code> in netlistsvg case 6. The log records each of these.</li>
      <li>A tool that produced no drawing passing the check in a circuit shows no drawing for that cell, only the reason. tscircuit did that in cases 5 and 7; the failing attempts are logged but not shown.</li>
    </ul>
  </section>

  <section>
    <h2>The drawings</h2>
    <p class="hint">Click any drawing to open the original PNG at full size. Each drawing is scaled to fit its cell, so the scale differs between cells.</p>
${sections}
  </section>

  <section class="notes">
    <h2>Four notes on the set</h2>
    <h3>Case 7 in SKiDL: a tool failure</h3>
    <p>SKiDL's router failed on this circuit and the fallback placement stacked C1-C4, R1-R3 and J1 behind U1, so only the two ICs are visible. The connection check still passes, but the drawing does not show the circuit, so it is kept as the tool's honest output and marked as a tool failure rather than used as a fair comparison.</p>
    <h3>Case 4 in tscircuit: a tool failure</h3>
    <p>Q3's symbol is not drawn; tscircuit prints an error in its place. The circuit JSON still has Q3's ports and traces, so the connection check passes, but the drawing does not show the part. It is kept as the tool's honest output and marked as a tool failure.</p>
    <h3>Cases 5 and 7 in tscircuit: no passing drawing</h3>
    <p>Every attempt in these two circuits failed the connection check, so neither cell shows a drawing. In case 5 the 3V3 pull-ups never reach the U1/U2/U3 supply; in case 7 the most readable attempt draws the GND rail through C2's 5 V pin. The attempts and the check output are in the log.</p>
    <h3>What tscircuit does not print</h3>
    <p>tscircuit does not print battery voltages or diode and transistor part numbers. That is the tool, not the converter: the netlist and pin map are correct, and the details are in the log.</p>
  </section>
</main>

<footer>
  Built by <code>npm run showcase</code> from <code>out/phase0/validation</code> and <code>baselines/out</code>. The attempt budget, the revisions and the known defects are in <a href="../../baselines/LOG.md">baselines/LOG.md</a>.
</footer>
</body>
</html>
`;
}

async function main(): Promise<void> {
  if (!existsSync(path.join(ROOT, "package.json"))) {
    throw new Error(`run this from the repo root (no package.json in ${ROOT})`);
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(IMG, { recursive: true });

  const images = await copyImages();

  const svg = comparisonSvg(images);
  const png = renderPng(svg);
  if (png.length > 3 * 1024 * 1024) {
    throw new Error(`comparison.png is ${(png.length / 1024 / 1024).toFixed(2)} MB, over the 3 MB limit`);
  }
  await writeFile(path.join(OUT, "comparison.png"), png);
  await writeFile(path.join(OUT, "index.html"), htmlPage(images), "utf8");

  const kb = Math.round(png.length / 1024);
  console.log(`wrote docs/showcase/ (${images.size} images, comparison.png ${kb} KB)`);
}

await main();
