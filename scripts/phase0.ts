// Phase 0b case run (SPEC 15): load every validation case, lay it out, run verification layers
// 1-4, write SVG + PNG and a JSON summary to out/phase0/validation/; then apply every edit script
// for cases 3, 5 and 7, writing before/after images and the gate 4 stability numbers to
// out/phase0/edits/.
//
//   npm run phase0            validation set only (never reads phase0/cases/test/)
//   npm run phase0 -- --test  also the test set and the case 11 edit scripts (end gate only)
//
// A case whose part types the engine cannot draw yet is reported as "missing symbol: X", not a crash.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cmpNatural, cmpStr } from "../src/geom/geom.js";
import { layout, pinDefsOf, type LayoutResult } from "../src/layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { toPng } from "../src/render/png.js";
import { readProject, type LoadedProject } from "../src/io/project.js";
import { applyEditScript, readEditScript } from "../src/io/edit-script.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE0 = join(ROOT, "phase0");
const CASES = join(PHASE0, "cases");
const OUT = join(ROOT, "out", "phase0");
const withTest = process.argv.includes("--test");
const EDIT_CASES = ["03", "05", "07", ...(withTest ? ["11"] : [])];
const EDIT_KINDS = ["longer-value", "add-part", "remove-part", "pin-sides"];

interface CaseSummary {
  case: string;
  set: string;
  status: string;
  layout?: string;
  verifier?: "valid" | "INVALID";
  overlaps?: number;
  conventions?: string[];
  breaches?: string[];
  metrics?: DrawingCheck["metrics"];
  missingSymbols: string[];
  issues: string[];
  warnings: string[];
  notes: string[];
  ms?: number;
  images?: string[];
}

interface EditSummary {
  script: string;
  case: string;
  edit?: string;
  status: string;
  expectOk?: boolean | "either";
  asExpected?: boolean;
  mode?: string;
  layout?: string;
  affected?: { expected?: string[]; actual: string[]; match?: boolean };
  gate4?: {
    untouched: number; meanMove: number; maxMove: number; turned: string[]; lockedMoved: string[];
    routesAffected: string[]; routesOther: string[]; portStubs: string[]; breaks: string[]; pass: boolean;
  };
  removedHints?: string[];
  issues: string[];
  images?: string[];
}

let failures = 0;
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");

/** Types in the project the engine cannot draw yet (no symbol, not ic, module or own pins it knows). */
function missingSymbols(p: LoadedProject): string[] {
  const defs = pinDefsOf(p.circuit);
  return [...new Set(p.circuit.parts.filter((x) => !defs[x.id]).map((x) => x.type))].sort(cmpNatural);
}

function draw(r: LayoutResult, dir: string, name: string): string[] {
  const svg = toSvg(r.render!);
  writeFileSync(join(dir, `${name}.svg`), svg);
  writeFileSync(join(dir, `${name}.png`), toPng(svg));
  return [rel(join(dir, `${name}.svg`)), rel(join(dir, `${name}.png`))];
}

function load(path: string): { project?: LoadedProject; status?: string; missing: string[]; issues: string[]; warnings: string[] } {
  const r = readProject(path);
  const warnings = r.warnings.map((w) => `${w.code} ${w.message}`);
  if (r.missingTypes.length) return { status: `missing symbol: ${r.missingTypes.join(", ")}`, missing: r.missingTypes, issues: r.errors.filter((e) => e.code !== "E201").map((e) => `${e.code} ${e.message}`), warnings };
  if (!r.ok || !r.project) return { status: `load error: ${r.errors[0]?.code ?? "?"}`, missing: [], issues: r.errors.map((e) => `${e.code} ${e.message}`), warnings };
  const missing = missingSymbols(r.project);
  if (missing.length) return { project: r.project, status: `missing symbol: ${missing.join(", ")}`, missing, issues: [], warnings };
  return { project: r.project, missing: [], issues: [], warnings };
}

function runCase(set: string, file: string, outDir: string): CaseSummary {
  const name = file.replace(/\.json$/, "");
  const s: CaseSummary = { case: name, set, status: "", missingSymbols: [], issues: [], warnings: [], notes: [] };
  try {
    const l = load(join(CASES, set, file));
    s.missingSymbols = l.missing; s.issues = l.issues; s.warnings = l.warnings;
    if (l.status) { s.status = l.status; return s; }
    const t0 = performance.now();
    const r = layout(l.project!);
    s.ms = Math.round(performance.now() - t0);
    s.layout = r.status;
    s.notes = r.notes;
    s.issues.push(...r.issues);
    if (!r.render) { s.status = r.status; return s; }
    const q = checkDrawing(l.project!.circuit, r.pinDefs, r.render);
    s.verifier = q.connections.valid ? "valid" : "INVALID";
    s.overlaps = q.overlaps.length;
    s.conventions = q.conventions.map((f) => `${f.id} ${f.message}`);
    s.breaches = q.breaches.map((b) => b.message);
    s.metrics = q.metrics;
    s.issues.push(...q.connections.errors.map((e) => `verifier ${e.code} ${e.message}`), ...q.overlaps.map((o) => `overlap ${o.code} ${o.message}`));
    s.images = draw(r, outDir, name);
    s.status = !q.connections.valid ? "INVALID (verifier)" : q.overlaps.length ? "INVALID (overlaps)" : r.status;
    if (!q.connections.valid) failures++;
  } catch (e) {
    s.status = `error: ${(e as Error).message}`;
    failures++;
  }
  return s;
}

function runEdit(scriptFile: string, outDir: string): EditSummary {
  const name = scriptFile.replace(/\.json$/, "");
  const s: EditSummary = { script: name, case: "", status: "", issues: [] };
  try {
    const parsed = readEditScript(join(CASES, "edits", scriptFile));
    if (!parsed.ok) { s.status = "script error"; s.issues = parsed.issues.map((i) => `${i.code} ${i.message}`); return s; }
    const script = parsed.script;
    s.case = script.case ?? "";
    if (script.edit) s.edit = script.edit;
    if (script.expect?.ok !== undefined) s.expectOk = script.expect.ok;
    if (!script.case || (script.case.startsWith("test/") && !withTest)) { s.status = "skipped (case not in this run)"; return s; }
    const l = load(join(CASES, script.case));
    if (l.status) { s.status = l.status; s.issues = l.issues; return s; }
    const before = layout(l.project!);
    if (!before.render || !before.state) { s.status = `before: ${before.status}`; s.issues = before.issues; return s; }
    s.images = draw(before, outDir, `${name}.before`);
    const run = applyEditScript(l.project!, script, before.state);
    s.status = run.result.saved ? "saved" : `rejected (${run.result.status})`;
    s.asExpected = run.asExpected;
    if (run.result.mode) s.mode = run.result.mode;
    if (run.result.layout) s.layout = run.result.layout.status;
    s.affected = run.affected;
    s.removedHints = run.removedHints;
    s.issues = run.result.issues;
    if (run.stability) {
      const r = run.stability.report;
      s.gate4 = {
        untouched: r.untouched.count, meanMove: r.untouched.meanMove, maxMove: r.untouched.maxMove, turned: r.untouched.turned,
        lockedMoved: r.lockedMoved, routesAffected: r.routesChanged.affected, routesOther: r.routesChanged.other, portStubs: r.routesChanged.portStubs,
        breaks: run.stability.breaks, pass: run.stability.breaks.length === 0,
      };
    }
    if (run.result.saved && run.result.layout?.render) {
      s.images.push(...draw(run.result.layout, outDir, `${name}.after`));
      if (run.result.check && !run.result.check.connections.valid) failures++;
    }
  } catch (e) {
    s.status = `error: ${(e as Error).message}`;
    failures++;
  }
  return s;
}

// ---------------------------------------------------------------------------

const sets = ["validation", ...(withTest ? ["test"] : [])];
const cases: CaseSummary[] = [];
for (const set of sets) {
  const outDir = join(OUT, set);
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(join(CASES, set)).filter((f) => f.endsWith(".json")).sort(cmpStr);
  const rows = files.map((f) => runCase(set, f, outDir));
  cases.push(...rows);
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify({ set, cases: rows }, null, 2)}\n`);
}

const editDir = join(OUT, "edits");
mkdirSync(editDir, { recursive: true });
const edits: EditSummary[] = [];
for (const c of EDIT_CASES) for (const k of EDIT_KINDS) {
  const f = `case${c}-${k}.json`;
  if (!existsSync(join(CASES, "edits", f))) { edits.push({ script: f.replace(/\.json$/, ""), case: "", status: "no such script", issues: [] }); continue; }
  edits.push(runEdit(f, editDir));
}
writeFileSync(join(editDir, "summary.json"), `${JSON.stringify({ edits }, null, 2)}\n`);

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
process.exitCode = failures ? 1 : 0;
