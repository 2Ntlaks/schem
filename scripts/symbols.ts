// Draws the Phase 0b symbols for looking at them:
//   out/symbols/<circuit>.png  one small circuit per symbol (tests/support/symbol-circuits.ts), laid out and checked;
//   out/symbols/sheet.png      every built-in symbol plus a header, with pin numbers at the anchors.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout, xformPath } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";
import { BUILTIN, keepOut, type SymbolDef } from "../src/symbols/library.js";
import { headerFor } from "../src/layout/kinds.js";
import { step, xformPt, type Pt } from "../src/geom/geom.js";
import type { Art, RenderModel } from "../src/render/model.js";
import { SYMBOL_CIRCUITS } from "../tests/support/symbol-circuits.js";

const dir = join("out", "symbols");
mkdirSync(dir, { recursive: true });
let bad = 0;
for (const [name, { project }] of Object.entries(SYMBOL_CIRCUITS)) {
  const r = layout(project);
  if (!r.render) { console.log(`${name}: ${r.status}\n  ${r.issues.join("\n  ")}`); bad++; continue; }
  const q = checkDrawing(project.circuit, r.pinDefs, r.render);
  writeFileSync(join(dir, `${name}.png`), toPng(toSvg(r.render)));
  if (!q.valid || r.status !== "valid") bad++;
  console.log(`${name}: layout ${r.status}, verifier ${q.connections.valid ? "valid" : "INVALID"}, overlaps ${q.overlaps.length}, crossings ${q.metrics.crossings}, bends ${q.metrics.bends}`);
  for (const i of r.issues) console.log(`  issue: ${i}`);
  for (const e of q.connections.errors) console.log(`  verifier: ${e.code} ${e.message}`);
  for (const o of q.overlaps) console.log(`  overlap: ${o.code} ${o.message}`);
  for (const f of q.conventions) console.log(`  convention: ${f.id} ${f.message}`);
  for (const b of q.breaches) console.log(`  readability: ${b.message}`);
}

// Symbol sheet: each symbol at rotation 0 in a grid cell, its keep-out dotted, pin numbers at the anchors.
const syms: SymbolDef[] = [
  ...Object.values(BUILTIN).filter((s) => s.kind !== "port"),
  headerFor([{ number: "1", name: "VCC", role: "power_in" }, { number: "2", name: "SDA", role: "bidir" }, { number: "3", name: "SCL", role: "bidir" }, { number: "4", name: "GND", role: "ground" }]),
];
const art: Art[] = [];
const COLS = 4, CW = 20, CH = 17;
syms.forEach((s, i) => {
  const ko = keepOut(s);
  const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
  const o: Pt = [cx + Math.round((CW - ko.w) / 2) - ko.x, cy + 4 - ko.y];
  const or = { rot: 0 as const, flip: false };
  for (const g of s.graphics) art.push({ t: "path", d: xformPath(g.d, o, or), fill: g.fill ?? "none" });
  for (const t of s.texts ?? []) { const c = xformPt(t.at, o, or); art.push({ t: "text", x: c[0], y: c[1], text: t.text, size: t.size, anchor: "middle", baseline: "middle" }); }
  for (const p of s.pins) {
    const a = xformPt(p.at, o, or), b = step(a, p.dir, 1);
    const r = 0.25;
    art.push({ t: "path", d: `M${(a[0] - r) * 10} ${a[1] * 10} A${r * 10} ${r * 10} 0 1 0 ${(a[0] + r) * 10} ${a[1] * 10} A${r * 10} ${r * 10} 0 1 0 ${(a[0] - r) * 10} ${a[1] * 10} Z`, fill: "stroke" });
    // Sideways pins show "number name"; up and down pins (often 1-2 G apart) show the number only,
    // and their names go in the caption.
    const label = p.number === p.name || !(p.dir === "left" || p.dir === "right") ? p.number : `${p.number} ${p.name}`;
    const anchor = p.dir === "left" ? "end" : p.dir === "right" ? "start" : "middle";
    const baseline = p.dir === "up" ? "bottom" : p.dir === "down" ? "top" : "middle";
    art.push({ t: "text", x: b[0], y: b[1], text: label, size: 8, anchor, baseline });
  }
  art.push({ t: "text", x: cx + CW / 2, y: cy + CH - 3, text: s.id, size: 12, anchor: "middle", baseline: "bottom" });
  const vert = s.pins.filter((p) => (p.dir === "up" || p.dir === "down") && p.name !== p.number).map((p) => `${p.number} ${p.name}`);
  if (vert.length) art.push({ t: "text", x: cx + CW / 2, y: cy + CH - 1.6, text: vert.join(", "), size: 8, anchor: "middle", baseline: "bottom" });
});
const rows = Math.ceil(syms.length / COLS);
const sheet: RenderModel = { electrical: { pins: [], wires: [], dots: [], ports: [], ncMarks: [] }, art, bounds: { x: -1, y: -1, w: COLS * CW + 2, h: rows * CH + 2 }, meta: { title: "Symbol sheet" } };
writeFileSync(join(dir, "sheet.png"), toPng(toSvg(sheet), 20));
console.log(`sheet: ${syms.length} symbols -> ${join(dir, "sheet.png")}`);
process.exitCode = bad ? 1 : 0;
