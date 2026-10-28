// Phase 0b case run (SPEC 15): load every validation case, lay it out, run verification layers
// 1-4, write SVG + PNG and a JSON summary to out/phase0/validation/; then apply every edit script
// for cases 3, 5 and 7, writing before/after images and the gate 4 stability numbers to
// out/phase0/edits/.
//
//   npm run phase0            validation set only (never reads phase0/cases/test/)
//   npm run phase0 -- --test  also the test set and the case 11 edit scripts (end gate only)
//
// A case whose part types the engine cannot draw yet is reported as "missing symbol: X", not a crash.
// The case and edit runs themselves live in scripts/lib/case-run.ts, shared with `npm run gates`.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cmpStr } from "../src/geom/geom.js";
import { CASES, ROOT, editScriptFiles, rel, runCase, runEdit, type CaseSummary, type EditSummary } from "./lib/case-run.js";
import { phase0Gates } from "./lib/phase0-gates.js";

const OUT = join(ROOT, "out", "phase0");
const withTest = process.argv.includes("--test");
const EDIT_CASES = ["03", "05", "07", ...(withTest ? ["11"] : [])];

// ---------------------------------------------------------------------------

const sets = ["validation", ...(withTest ? ["test"] : [])];
const cases: CaseSummary[] = [];
for (const set of sets) {
  const outDir = join(OUT, set);
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(join(CASES, set)).filter((f) => f.endsWith(".json")).sort(cmpStr);
  const rows = files.map((f) => runCase(set, f, outDir).summary);
  cases.push(...rows);
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify({ set, cases: rows.map(({ failed: _f, ...r }) => r) }, null, 2)}\n`);
}

const editDir = join(OUT, "edits");
mkdirSync(editDir, { recursive: true });
const edits: EditSummary[] = [];
for (const f of editScriptFiles(EDIT_CASES)) {
  if (!existsSync(join(CASES, "edits", f))) { edits.push({ script: f.replace(/\.json$/, ""), case: "", status: "no such script", issues: [] }); continue; }
  edits.push(runEdit(f, editDir, { withTest }));
}
writeFileSync(join(editDir, "summary.json"), `${JSON.stringify({ edits: edits.map(({ failed: _f, ...e }) => e) }, null, 2)}\n`);
const failures = [...cases, ...edits].filter((x) => x.failed).length;

// Console tables.
const pad = (s: unknown, n: number) => String(s ?? "").padEnd(n);
console.log(`${pad("case", 30)} ${pad("status", 34)} ${pad("verifier", 9)} ${pad("overlaps", 8)} ${pad("conv", 4)} ${pad("read", 4)} ms`);
for (const c of cases) console.log(`${pad(c.case, 30)} ${pad(c.status, 34)} ${pad(c.verifier ?? "-", 9)} ${pad(c.overlaps ?? "-", 8)} ${pad(c.conventions?.length ?? "-", 4)} ${pad(c.breaches?.length ?? "-", 4)} ${c.ms ?? "-"}`);
console.log("");
console.log(`${pad("edit script", 26)} ${pad("status", 34)} ${pad("expect", 6)} ${pad("as exp", 6)} ${pad("affected", 8)} ${pad("mode", 19)} gate 4`);
for (const e of edits) {
  const g = e.gate4 ? `${e.gate4.pass ? "pass" : "FAIL"} (untouched ${e.gate4.untouched}, mean ${e.gate4.meanMove} G, max ${e.gate4.maxMove} G, other routes ${e.gate4.routesOther.length})` : "-";
  const aff = e.affected?.match === undefined ? "-" : e.affected.match ? "same" : "differs";
  console.log(`${pad(e.script, 26)} ${pad(e.status, 34)} ${pad(e.expectOk ?? "-", 6)} ${pad(e.asExpected ?? "-", 6)} ${pad(aff, 8)} ${pad(e.mode ?? "-", 19)} ${g}`);
  if (e.affected?.match === false) console.log(`    affected: frozen expect (rev C.2 table) ${e.affected.expected?.join(" ")}; recomputed (rev C.3, used by gate 4) ${e.affected.actual.join(" ") || "(none)"}`);
  if (e.gate4 && !e.gate4.pass) for (const b of e.gate4.breaks) console.log(`    gate 4: ${b}`);
  if (e.removedHints?.length) console.log(`    removed hints: ${e.removedHints.join(", ")}`);
  if (!e.status.startsWith("saved")) for (const i of e.issues.slice(0, 2)) console.log(`    ${i}`);
}
console.log(`\nwrote ${rel(OUT)}/ (${sets.join(", ")}, edits)`);
const gates = phase0Gates(cases, edits, withTest);
writeFileSync(join(OUT, "gates.json"), `${JSON.stringify({ scope: withTest ? "full" : "validation", gates }, null, 2)}\n`);
for (const g of gates) {
  console.log(`gate ${g.gate}: ${g.status} (${g.evaluated}/${g.required} results)${g.reason ? `: ${g.reason}` : ""}`);
  for (const failure of g.failures) console.log(`    ${failure}`);
}
// Incomplete ratings/holdout evidence is never presented as a passed phase.
process.exitCode = failures || gates.some((g) => g.status === "fail") ? 1 : 0;
