// The general-layout benchmark: `npm run bench`.
//
// Draws every circuit in bench/circuits/ (everyday circuits, most with no template), scores each
// drawing (scripts/lib/bench-score.ts, lower is better) and compares with bench/baseline.json.
// Images go to out/bench/, with one page, out/bench/index.html, to look at them side by side.
//
//   npm run bench               draw, score, compare with the baseline
//   npm run bench -- --update   also write the scores as the new baseline
//   npm run bench -- --check    exit 1 when a circuit got worse than the baseline or stopped drawing
//
// A lower total does not prove a drawing is better: open the page and look.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { readProject } from "../src/io/project.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";
import { cmpNatural } from "../src/geom/geom.js";
import { scoreDrawing, WEIGHTS, type Score } from "./lib/bench-score.js";
import { ROOT } from "./lib/case-run.js";

const DIR = join(ROOT, "bench", "circuits"), OUT = join(ROOT, "out", "bench"), BASE = join(ROOT, "bench", "baseline.json");
const args = new Set(process.argv.slice(2));
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

interface Row { name: string; title: string; status: string; score?: Score; total: number; notes: string[]; ms: number }

mkdirSync(OUT, { recursive: true });
const files = readdirSync(DIR).filter((f) => f.endsWith(".schem.json")).sort(cmpNatural)
  .filter((f) => !only.length || only.some((o) => f.startsWith(o)));
const rows: Row[] = [];
for (const f of files) {
  const name = f.replace(/\.schem\.json$/, "");
  const loaded = readProject(join(DIR, f));
  if (!loaded.ok || !loaded.project) { rows.push({ name, title: name, status: `load error ${loaded.errors[0]?.code ?? ""}`, total: WEIGHTS.notDrawn, notes: loaded.errors.map((e) => e.message), ms: 0 }); continue; }
  const p = loaded.project;
  const title = p.meta.title ?? name;
  const t0 = performance.now();
  try {
    const r = layout(p);
    const ms = Math.round(performance.now() - t0);
    if (!r.render) { rows.push({ name, title, status: r.status, total: WEIGHTS.notDrawn, notes: r.issues, ms }); continue; }
    const q = checkDrawing(p.circuit, r.pinDefs, r.render);
    const svg = toSvg(r.render);
    writeFileSync(join(OUT, `${name}.svg`), svg);
    writeFileSync(join(OUT, `${name}.png`), toPng(svg));
    const score = scoreDrawing(p.circuit, r.pinDefs, r.render, q);
    const drawn = q.valid && (r.status === "valid" || r.status === "valid_low_confidence");
    const status = !q.connections.valid ? "INVALID (verifier)" : q.overlaps.length ? "INVALID (overlaps)" : r.status;
    const total = Math.round((score.total + (drawn ? 0 : WEIGHTS.notDrawn) + (r.status === "valid_low_confidence" ? WEIGHTS.lowConfidence : 0)) * 10) / 10;
    rows.push({ name, title, status, score, total, notes: [...r.issues, ...q.conventions.map((c) => c.message), ...q.breaches.map((b) => b.message)], ms });
  } catch (e) {
    rows.push({ name, title, status: `crash: ${(e as Error).message}`, total: WEIGHTS.notDrawn, notes: [], ms: Math.round(performance.now() - t0) });
  }
}

const baseline: Record<string, number> = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")).scores : {};
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (s: string | number, n: number) => String(s).padStart(n);
console.log(`${pad("circuit", 18)}${pad("status", 22)}${num("score", 8)}${num("was", 8)}${num("cross", 7)}${num("bends", 7)}${num("wire", 6)}${num("conv", 6)}${num("limit", 7)}${num("back", 6)}${num("upstr", 7)}`);
let worse = 0, sum = 0, was = 0, comparable = true;
for (const r of rows) {
  const b = baseline[r.name];
  if (b === undefined) comparable = false; else was += b;
  sum += r.total;
  const mark = b === undefined ? "" : r.total > b + 0.05 ? " worse" : r.total < b - 0.05 ? " better" : "";
  if (mark === " worse") worse++;
  const s = r.score;
  console.log(`${pad(r.name, 18)}${pad(r.status, 22)}${num(r.total, 8)}${num(b ?? "-", 8)}${num(s?.crossings ?? "-", 7)}${num(s?.bends ?? "-", 7)}${num(s?.wire ?? "-", 6)}${num(s?.conventions ?? "-", 6)}${num(s?.breaches ?? "-", 7)}${num(s?.backwards ?? "-", 6)}${num(s?.upstream ?? "-", 7)}${mark}`);
}
const clean = rows.filter((r) => r.status === "valid").length;
console.log(`\n${rows.length} circuits, ${clean} valid. Total score ${Math.round(sum * 10) / 10}${comparable && rows.length ? ` (baseline ${Math.round(was * 10) / 10})` : ""}. Images: out/bench/index.html`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>schem bench</title>
<style>body{font:14px/1.4 Georgia,serif;margin:24px;background:#f4f1ea;color:#182a38}h1{font-size:20px}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #d8d2c4;padding:12px}img{max-width:100%;display:block;margin:auto}
figcaption{margin-top:8px}b.bad{color:#bf5238}small{color:#5b6b76}</style>
<h1>schem bench: ${rows.length} circuits, ${clean} valid, total score ${Math.round(sum * 10) / 10}</h1><div class="g">
${rows.map((r) => `<figure><img src="${r.name}.png" alt="${esc(r.title)}"><figcaption><b${r.status === "valid" ? "" : ' class="bad"'}>${esc(r.title)}</b>: ${esc(r.status)}, score ${r.total}${baseline[r.name] !== undefined ? ` (was ${baseline[r.name]})` : ""}<br><small>${esc(r.notes.join(" | "))}</small></figcaption></figure>`).join("\n")}
</div>`);

if (args.has("--update")) {
  writeFileSync(BASE, `${JSON.stringify({ note: "Scores from npm run bench -- --update. Lower is better; see scripts/lib/bench-score.ts.", scores: Object.fromEntries(rows.map((r) => [r.name, r.total])) }, null, 2)}\n`);
  console.log("Baseline written: bench/baseline.json");
}
if (args.has("--check") && (worse || rows.some((r) => r.status.startsWith("INVALID") || r.status.startsWith("crash")))) {
  console.log(`${worse} circuit(s) scored worse than the baseline.`);
  process.exitCode = 1;
}
