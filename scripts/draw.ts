// Lay out, check (verification layers 1-4) and render every case in cases/ (or the files given),
// writing out/<name>.svg and .png.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { layout, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync("cases").filter((f) => f.endsWith(".json")).map((f) => join("cases", f));
mkdirSync("out", { recursive: true });
let bad = 0;
for (const f of files) {
  const project = JSON.parse(readFileSync(f, "utf8")) as Project;
  const name = basename(f, ".json");
  const t0 = performance.now();
  const r = layout(project);
  const ms = performance.now() - t0;
  if (!r.render) { console.log(`${name}: ${r.status}\n  ${r.issues.join("\n  ")}`); bad++; continue; }
  const q = checkDrawing(project.circuit, r.pinDefs, r.render);
  const v = q.connections;
  const svg = toSvg(r.render);
  writeFileSync(join("out", `${name}.svg`), svg);
  writeFileSync(join("out", `${name}.png`), toPng(svg));
  const status = !v.valid ? "INVALID (verifier)" : q.overlaps.length ? "INVALID (overlaps)" : r.status;
  if (!q.valid || r.status !== "valid") bad++;
  const x = q.metrics;
  console.log(`${name}: layout ${r.status}, verifier ${v.valid ? "valid" : "INVALID"}, overlaps ${q.overlaps.length} -> ${status}  (${ms.toFixed(0)} ms)`);
  console.log(`  metrics: crossings ${x.crossings}, bends ${x.bends}, length ${x.wireLength}, dots ${x.dots}, sheet ${x.sheet.join("x")}`);
  for (const n of r.notes) console.log(`  note: ${n}`);
  for (const i of r.issues) console.log(`  issue: ${i}`);
  for (const e of v.errors) console.log(`  verifier: ${e.code} ${e.message}`);
  for (const w of v.warnings) console.log(`  warning: ${w.code} ${w.message}`);
  for (const o of q.overlaps) console.log(`  overlap: ${o.code} ${o.message}`);
  for (const f of q.conventions) console.log(`  convention: ${f.id} ${f.message}`);
  for (const b of q.breaches) console.log(`  readability: ${b.message}`);
}
process.exitCode = bad ? 1 : 0;
