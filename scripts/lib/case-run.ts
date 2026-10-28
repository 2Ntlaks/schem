// Shared Phase 0b case and edit-script runs, used by `npm run phase0` (scripts/phase0.ts) and
// `npm run gates` (scripts/gates.ts). Load a frozen case, lay it out, run verification layers 1-4,
// draw SVG + PNG; apply an edit script to its case and measure gate 4 stability.
//
// Nothing here lists a folder: callers pass the case and script paths they mean to run.

import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cmpNatural } from "../../src/geom/geom.js";
import { layout, pinDefsOf, type LayoutResult } from "../../src/layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../../src/quality/index.js";
import { toSvg } from "../../src/render/svg.js";
import { toPng } from "../../src/render/png.js";
import { readProject, type LoadedProject } from "../../src/io/project.js";
import { applyEditScript, readEditScript, type EditScript } from "../../src/io/edit-script.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CASES = join(ROOT, "phase0", "cases");
export const EDIT_KINDS = ["longer-value", "add-part", "remove-part", "pin-sides"] as const;

export const rel = (p: string): string => relative(ROOT, p).split("\\").join("/");

export interface CaseSummary {
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
  /** A crash or a drawing the verifier rejects (the run exits 1). */
  failed?: boolean;
}

export interface Gate4Figures {
  untouched: number; meanMove: number; maxMove: number; turned: string[]; lockedMoved: string[];
  routesAffected: string[]; routesOther: string[]; portStubs: string[]; breaks: string[]; pass: boolean;
}

export interface EditSummary {
  script: string;
  case: string;
  edit?: string;
  status: string;
  expectOk?: boolean | "either";
  asExpected?: boolean;
  mode?: string;
  layout?: string;
  affected?: { expected?: string[]; actual: string[]; match?: boolean };
  gate4?: Gate4Figures;
  removedHints?: string[];
  issues: string[];
  images?: string[];
  failed?: boolean;
}

/** Types in the project the engine cannot draw yet (no symbol, not ic, module or own pins it knows). */
export function missingSymbols(p: LoadedProject): string[] {
  const defs = pinDefsOf(p.circuit);
  return [...new Set(p.circuit.parts.filter((x) => !defs[x.id]).map((x) => x.type))].sort(cmpNatural);
}

/** Write `<name>.svg` and `<name>.png` into `dir`; returns both paths relative to the repo. */
export function draw(r: LayoutResult, dir: string, name: string): string[] {
  const svg = toSvg(r.render!);
  writeFileSync(join(dir, `${name}.svg`), svg);
  writeFileSync(join(dir, `${name}.png`), toPng(svg));
  return [rel(join(dir, `${name}.svg`)), rel(join(dir, `${name}.png`))];
}

export interface Loaded { project?: LoadedProject; status?: string; missing: string[]; issues: string[]; warnings: string[] }

/** Load a case file; `status` is set when the case cannot be laid out (load error, missing symbol). */
export function loadCase(path: string): Loaded {
  const r = readProject(path);
  const warnings = r.warnings.map((w) => `${w.code} ${w.message}`);
  if (r.missingTypes.length) return { status: `missing symbol: ${r.missingTypes.join(", ")}`, missing: r.missingTypes, issues: r.errors.filter((e) => e.code !== "E201").map((e) => `${e.code} ${e.message}`), warnings };
  if (!r.ok || !r.project) return { status: `load error: ${r.errors[0]?.code ?? "?"}`, missing: [], issues: r.errors.map((e) => `${e.code} ${e.message}`), warnings };
  const missing = missingSymbols(r.project);
  if (missing.length) return { project: r.project, status: `missing symbol: ${missing.join(", ")}`, missing, issues: [], warnings };
  return { project: r.project, missing: [], issues: [], warnings };
}

export interface CaseRun { summary: CaseSummary; project?: LoadedProject; result?: LayoutResult; check?: DrawingCheck }

/**
 * Lay out one case file (`<casesDir>/<set>/<file>`), check it with layers 1-4 and, when it drew,
 * write `<outDir>/<case>.svg|png`. Never throws: a crash is reported in the summary.
 */
export function runCase(set: string, file: string, outDir: string, casesDir = CASES): CaseRun {
  const name = file.replace(/\.json$/, "");
  const s: CaseSummary = { case: name, set, status: "", missingSymbols: [], issues: [], warnings: [], notes: [] };
  const run: CaseRun = { summary: s };
  try {
    const l = loadCase(join(casesDir, set, file));
    s.missingSymbols = l.missing; s.issues = l.issues; s.warnings = l.warnings;
    if (l.status) { s.status = l.status; return run; }
    run.project = l.project!;
    const t0 = performance.now();
    const r = layout(l.project!);
    s.ms = Math.round(performance.now() - t0);
    run.result = r;
    s.layout = r.status;
    s.notes = r.notes;
    s.issues.push(...r.issues);
    if (!r.render) { s.status = r.status; return run; }
    const q = checkDrawing(l.project!.circuit, r.pinDefs, r.render);
    run.check = q;
    s.verifier = q.connections.valid ? "valid" : "INVALID";
    s.overlaps = q.overlaps.length;
    s.conventions = q.conventions.map((f) => `${f.id} ${f.message}`);
    s.breaches = q.breaches.map((b) => b.message);
    s.metrics = q.metrics;
    s.issues.push(...q.connections.errors.map((e) => `verifier ${e.code} ${e.message}`), ...q.overlaps.map((o) => `overlap ${o.code} ${o.message}`));
    s.images = draw(r, outDir, name);
    s.status = !q.connections.valid ? "INVALID (verifier)" : q.overlaps.length ? "INVALID (overlaps)" : r.status;
    if (!q.connections.valid) s.failed = true;
  } catch (e) {
    s.status = `error: ${(e as Error).message}`;
    s.failed = true;
  }
  return run;
}

/**
 * Apply one edit script (`<casesDir>/edits/<scriptFile>`) to the case it names: lay the case out,
 * draw `<script>.before`, apply the script incrementally, draw `<script>.after`, and report the
 * gate 4 figures. A script whose case is in the test set is skipped unless `withTest`.
 */
export function runEdit(scriptFile: string, outDir: string, opts: { withTest: boolean; casesDir?: string }): EditSummary {
  const casesDir = opts.casesDir ?? CASES;
  const name = scriptFile.replace(/\.json$/, "");
  const s: EditSummary = { script: name, case: "", status: "", issues: [] };
  try {
    const parsed = readEditScript(join(casesDir, "edits", scriptFile));
    if (!parsed.ok) { s.status = "script error"; s.issues = parsed.issues.map((i) => `${i.code} ${i.message}`); return s; }
    const script: EditScript = parsed.script;
    s.case = script.case ?? "";
    if (script.edit) s.edit = script.edit;
    if (script.expect?.ok !== undefined) s.expectOk = script.expect.ok;
    if (!script.case || (script.case.startsWith("test/") && !opts.withTest)) { s.status = "skipped (case not in this run)"; return s; }
    const l = loadCase(join(casesDir, script.case));
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
      if (run.result.check && !run.result.check.connections.valid) s.failed = true;
    }
  } catch (e) {
    s.status = `error: ${(e as Error).message}`;
    s.failed = true;
  }
  return s;
}

/** The edit-script file names for the given case numbers ("03"), built from the names, never listed. */
export function editScriptFiles(caseNumbers: readonly string[]): string[] {
  return caseNumbers.flatMap((c) => EDIT_KINDS.map((k) => `case${c}-${k}.json`));
}
