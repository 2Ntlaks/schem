// Phase 0b gate runner (SPEC 15, gates 1-6). Measures what can be measured mechanically and prepares
// the blind rating pack for the rest.
//
//   npm run gates                          validation set (cases 1-8, edit scripts of cases 3, 5, 7)
//   npm run gates -- --ratings owner.json  also tally ratings of a pack this runner built (gates 2, 3, 5)
//   npm run gates -- --test                END GATE ONLY: adds cases 9-12 and the case 11 edit scripts
//
// Options: --runs N (warm timing runs, default 7), --judges N (prompts in the pack, default 3),
// --seed N (pack shuffle; default derived from the images), --pairs ours|all|none (default ours),
// --agent-edits <dir> (agent edit calls, default out/gates/<set>/agent-edits/), --no-perf.
//
// Gate 1   every case: verifier passes, status valid (valid_low_confidence allowed on case 8 only).
// Gate 2/3/5  blind ratings. Each case is drawn twice: `schem-noedit` (as laid out) and `schem-edit`
//          (after at most one edit call of at most 3 visual operations, no absolute coordinates).
//          The edit call comes from <agent-edits>/caseNN.json when an agent wrote one (from the
//          findings this runner writes to findings/caseNN.json); otherwise the runner stands in for
//          the agent and takes the first checked fix that improves the drawing with no trade-off.
//          Baseline drawings are picked up from baselines/out/<tool>/<set>/caseNN/final.png when
//          present. All of these go into one blind pack (phase0/judge/blind-pack.ts) under
//          out/gates/<set>/packs/; the same images and seed give the same pack folder, so judges'
//          answers there survive a re-run. With --ratings (the owner's answer file, judge-answer
//          shape) and/or judges' answers in the pack, phase0/judge/tally.ts scores every image and
//          gates 2, 3 and 5 are computed from the owner's scores (the panel median when there is no
//          owner file, marked as an estimate).
// Gate 4   every edit script: stability report from the incremental edit (scripts/lib/case-run.ts).
// Gate 6   full pipeline (layout, verify + quality checks, findings with fix dry-runs), 1 cold + N warm
//          runs, median and p95 against the SPEC 13 item 11 target (30 parts: warm p95 < 3 s), on
//          case 11 (--test only; in the default mode the largest validation case stands in to
//          exercise the same code) and on one generated 30-part circuit (fixed seed).
//
// Test-set hygiene: without --test nothing under phase0/cases/test/ or phase0/cases/edits/case11-*
// is listed, read or run, and baseline drawings are looked up by validation case id only.
// Exit code 1 when any gate is measured as failed or a run crashed; incomplete gates do not fail.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cmpStr } from "../src/geom/geom.js";
import { layout, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { review, type ReviewFinding } from "../src/edit/findings.js";
import type { EditOp } from "../src/edit/edit.js";
import { applyEditScript, readEditScript, type EditScript } from "../src/io/edit-script.js";
import { generate } from "../tests/support/generate.js";
import { buildPack, type Key } from "../phase0/judge/blind-pack.js";
import { tally } from "../phase0/judge/tally.js";
import { CASES, ROOT, draw, editScriptFiles, loadCase, rel, runCase, runEdit, type CaseRun, type CaseSummary, type EditSummary } from "./lib/case-run.js";
import {
  PERF_TARGET_MS, all, gate1, gate1Row, gate4, gate4Row, perfVerdict, ratedGates,
  type RatedCase, type Verdict,
} from "./lib/gate-math.js";

// ------------------------------------------------------------------ options

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const opt = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const withTest = flag("test");
const RUNS = Number(opt("runs") ?? 7);
const JUDGES = Number(opt("judges") ?? 3);
const PAIRS = (opt("pairs") ?? "ours") as "all" | "ours" | "none";
if (!["all", "ours", "none"].includes(PAIRS)) throw new Error("--pairs must be all, ours or none");
const SET_NAME = withTest ? "test" : "validation";
const OUT = join(ROOT, "out", "gates", SET_NAME);
const AGENT_EDITS = opt("agent-edits") ?? join(OUT, "agent-edits");
const RATINGS = opt("ratings");
const SEED = opt("seed");
const BASELINES = join(ROOT, "baselines", "out");
const OURS = "schem";
const sets = ["validation", ...(withTest ? ["test"] : [])];
const EDIT_CASES = ["03", "05", "07", ...(withTest ? ["11"] : [])];
/** Gate 6's generated circuit: the first seed with exactly 30 parts and at most 150 pins at 16 patterns. */
const GEN = { seed: 30, patterns: 16, parts: 30, maxPins: 150 };
const VISUAL_OPS = new Set(["lock", "unlock", "setOrientation", "setPinSides", "setLabelSide", "setSpacing", "place", "align", "removeHint", "relayout"]);
const MAX_OPS = 3;

let crashed = 0;
const dir = (...p: string[]) => { const d = join(OUT, ...p); mkdirSync(d, { recursive: true }); return d; };
const caseId = (name: string) => /^case\d{2}/.exec(name)?.[0] ?? name;

// ------------------------------------------------------------------ gate 1: lay out every case

const drawings = dir("drawings");
const runs: CaseRun[] = [];
for (const set of sets) {
  const files = readdirSync(join(CASES, set)).filter((f) => f.endsWith(".json")).sort(cmpStr);
  for (const f of files) runs.push(runCase(set, f, drawings));
}
const cases: CaseSummary[] = runs.map((r) => r.summary);
crashed += cases.filter((c) => c.failed && c.status.startsWith("error")).length;
const g1 = gate1(cases);

// ------------------------------------------------------------------ gate 2 stages: no edit, after one edit call

interface Stage {
  case: string;
  set: string;
  noEdit?: string;
  afterEdit?: string;
  source: "agent" | "findings" | "none";
  ops: EditOp[];
  outcome: string;
  afterStatus?: string;
  afterVerifier?: "valid" | "INVALID";
  findings: number;
  fixes: number;
  issues: string[];
}

/** An agent edit call must be one transaction of at most 3 visual operations with no absolute coordinates. */
function agentCallProblems(s: EditScript): string[] {
  const p: string[] = [];
  if (s.ops.length > MAX_OPS) p.push(`${s.ops.length} operations (at most ${MAX_OPS})`);
  for (const o of s.ops) {
    if (!VISUAL_OPS.has(o.op)) p.push(`"${o.op}" is not a visual operation`);
    if (o.op === "lock" && o.at) p.push(`lock ${o.part} gives absolute coordinates`);
  }
  return p;
}

const findingsDir = dir("findings");
const stages: Stage[] = [];
for (const run of runs) {
  const s = run.summary;
  const id = caseId(s.case);
  const st: Stage = { case: s.case, set: s.set, source: "none", ops: [], outcome: "no drawing", findings: 0, fixes: 0, issues: [] };
  stages.push(st);
  const r = run.result;
  if (!run.project || !r?.render || !r.state || !s.images) continue;
  st.noEdit = join(ROOT, s.images[1]!);
  try {
    const found: ReviewFinding[] = review(run.project, r.state, r.render);
    st.findings = found.length;
    st.fixes = found.filter((f) => f.fix).length;
    writeFileSync(join(findingsDir, `${id}.json`), `${JSON.stringify({ case: s.case, status: r.status, findings: found }, null, 2)}\n`);

    let script: EditScript | undefined;
    const agentFile = join(AGENT_EDITS, `${id}.json`);
    if (existsSync(agentFile)) {
      st.source = "agent";
      const parsed = readEditScript(agentFile);
      if (!parsed.ok) { st.outcome = "invalid call"; st.issues = parsed.issues.map((i) => `${i.code} ${i.message}`); continue; }
      const bad = agentCallProblems(parsed.script);
      if (bad.length) { st.outcome = "invalid call"; st.issues = bad; continue; }
      script = parsed.script;
    } else {
      const fix = found.find((f) => f.fix && !f.fix.tradeoff && !f.fix.changesCircuit && agentCallProblems({ ops: f.fix.ops }).length === 0)?.fix;
      if (fix) { st.source = "findings"; script = { ops: fix.ops, expectedLayout: fix.expectedLayout }; }
    }
    if (!script || !script.ops.length) { st.outcome = "no edit"; st.afterEdit = st.noEdit; st.afterStatus = s.status; st.afterVerifier = s.verifier; continue; }
    st.ops = script.ops;
    const applied = applyEditScript(run.project, script, r.state);
    if (applied.result.saved && applied.result.layout?.render) {
      st.outcome = `saved (${applied.result.mode})`;
      st.afterStatus = applied.result.layout.status;
      st.afterVerifier = applied.result.check?.connections.valid ? "valid" : "INVALID";
      st.afterEdit = join(ROOT, draw(applied.result.layout, drawings, `${s.case}.after-edit`)[1]!);
    } else {
      // A refused call leaves the drawing as it was: the after-edit drawing is the no-edit one.
      st.outcome = `rejected (${applied.result.status})`;
      st.issues = applied.result.issues;
      st.afterEdit = st.noEdit; st.afterStatus = s.status; st.afterVerifier = s.verifier;
    }
  } catch (e) {
    st.outcome = `error: ${(e as Error).message}`;
    crashed++;
  }
}

// ------------------------------------------------------------------ gate 4: edit scripts

const editsDir = dir("edits");
const edits: EditSummary[] = [];
for (const f of editScriptFiles(EDIT_CASES)) {
  if (!existsSync(join(CASES, "edits", f))) { edits.push({ script: f.replace(/\.json$/, ""), case: "", status: "no such script", issues: [] }); continue; }
  edits.push(runEdit(f, editsDir, { withTest }));
}
crashed += edits.filter((e) => e.status.startsWith("error")).length;
const ranEdits = edits.filter((e) => !e.status.startsWith("skipped") && e.status !== "no such script");
const g4 = gate4(ranEdits);

// ------------------------------------------------------------------ gate 6: performance

interface Perf {
  name: string;
  role: "case 11" | "stand-in for case 11" | "generated";
  parts: number; pins: number; nets: number; textChars: number; findings: number;
  status: string;
  coldMs: number; warmMs: number[]; layoutMedianMs: number;
  median: number; p95: number; pass: boolean;
}

function timePipeline(name: string, role: Perf["role"], project: Project): Perf {
  const once = () => {
    const t0 = performance.now();
    const r = layout(project);
    const t1 = performance.now();
    let findings = 0;
    if (r.render && r.state) { checkDrawing(project.circuit, r.pinDefs, r.render); findings = review(project, r.state, r.render).length; }
    return { r, findings, total: performance.now() - t0, layout: t1 - t0 };
  };
  const cold = once();
  const warm = Array.from({ length: RUNS }, () => once());
  const r = cold.r;
  const pins = project.circuit.parts.reduce((a, p) => a + (r.pinDefs[p.id]?.length ?? 0), 0);
  const textChars = (r.render?.art ?? []).reduce((a, x) => a + (x.t === "text" ? x.text.length : 0), 0);
  const v = perfVerdict(warm.map((w) => w.total));
  const lay = perfVerdict(warm.map((w) => w.layout));
  return {
    name, role, parts: project.circuit.parts.length, pins, nets: project.circuit.nets.length, textChars, findings: cold.findings, status: r.status,
    coldMs: Math.round(cold.total), warmMs: warm.map((w) => Math.round(w.total)), layoutMedianMs: Math.round(lay.median),
    median: Math.round(v.median), p95: Math.round(v.p95), pass: v.pass,
  };
}

const perf: Perf[] = [];
let perfNote = "";
if (flag("no-perf")) perfNote = "skipped (--no-perf)";
else {
  if (withTest) {
    const f = readdirSync(join(CASES, "test")).filter((x) => x.startsWith("case11") && x.endsWith(".json")).sort(cmpStr)[0];
    const l = f ? loadCase(join(CASES, "test", f)) : undefined;
    if (l?.project && !l.status) perf.push(timePipeline(f!.replace(/\.json$/, ""), "case 11", l.project));
    else perfNote = `case 11: ${f ? l?.status : "file not found"}`;
  } else {
    // Default mode never opens the test set: the largest validation case runs the same code path.
    const biggest = runs.filter((r) => r.project).sort((a, b) => b.project!.circuit.parts.length - a.project!.circuit.parts.length || cmpStr(a.summary.case, b.summary.case))[0];
    if (biggest) perf.push(timePipeline(biggest.summary.case, "stand-in for case 11", biggest.project!));
    perfNote = "case 11 is in the test set: timed only with --test";
  }
  const g = generate(GEN.seed, GEN.patterns);
  const p = timePipeline(`generated #${GEN.seed} (${GEN.patterns} patterns)`, "generated", { circuit: g.circuit });
  if (p.parts !== GEN.parts || p.pins > GEN.maxPins) throw new Error(`generated circuit has ${p.parts} parts and ${p.pins} pins; gate 6 needs ${GEN.parts} parts and at most ${GEN.maxPins} pins (did tests/support/generate.ts change?)`);
  perf.push(p);
}
const perfCase11 = perf.find((p) => p.role === "case 11");
const perfGen = perf.find((p) => p.role === "generated");
const g6: Verdict = all(perfCase11 ? (perfCase11.pass ? "pass" : "fail") : "incomplete", perfGen ? (perfGen.pass ? "pass" : "fail") : "incomplete");

// ------------------------------------------------------------------ blind pack (gates 2, 3, 5)

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const renders = join(OUT, "renders");
rmSync(renders, { recursive: true, force: true });
mkdirSync(renders, { recursive: true });
const packNotes: string[] = [];
for (const st of stages) {
  const id = caseId(st.case);
  if (st.noEdit) copyFileSync(st.noEdit, join(renders, `${OURS}-noedit__${id}.png`));
  if (st.afterEdit) copyFileSync(st.afterEdit, join(renders, `${OURS}-edit__${id}.png`));
}
const baselineTools: string[] = [];
const baselineMissing: string[] = [];
if (existsSync(BASELINES)) {
  for (const tool of readdirSync(BASELINES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(cmpStr)) {
    if (!/^[A-Za-z0-9.-]+$/.test(tool) || tool === OURS || tool.startsWith(`${OURS}-`)) { packNotes.push(`baseline folder "${tool}" skipped: not a usable tool name`); continue; }
    let found = 0;
    // Looked up by the ids of the cases this run drew, so the default mode never lists a test folder.
    for (const st of stages) {
      const id = caseId(st.case);
      const png = join(BASELINES, tool, st.set, id, "final.png");
      if (!existsSync(png)) { baselineMissing.push(`${tool}/${id}`); continue; }
      if (!readFileSync(png).subarray(0, 8).equals(PNG_SIG)) { packNotes.push(`${rel(png)} is not a PNG; left out`); continue; }
      copyFileSync(png, join(renders, `${tool}__${id}.png`));
      found++;
    }
    if (found) baselineTools.push(tool); else packNotes.push(`baseline "${tool}": no drawings for these cases`);
  }
} else packNotes.push(`no baseline drawings yet (${rel(BASELINES)}/<tool>/<set>/caseNN/final.png)`);

const renderFiles = readdirSync(renders).filter((f) => f.endsWith(".png")).sort(cmpStr);
const digest = renderFiles.map((f) => `${f}:${createHash("sha256").update(readFileSync(join(renders, f))).digest("hex")}`).join("\n");
const seed = SEED !== undefined ? Number(SEED) >>> 0 : createHash("sha256").update(`seed\n${digest}`).digest().readUInt32BE(0);
const packsDir = dir("packs");
const packDir = join(packsDir, `panel-${createHash("sha256").update(`${seed}|${JUDGES}|${PAIRS}\n${digest}`).digest("hex").slice(0, 10)}`);
let key: Key | undefined;
let packState = "";
if (!renderFiles.length) packState = "no drawings to pack";
else if (existsSync(join(packDir, "sealed", "key.json"))) {
  key = JSON.parse(readFileSync(join(packDir, "sealed", "key.json"), "utf8"));
  packState = "reused (same drawings and seed)";
} else {
  rmSync(packDir, { recursive: true, force: true });
  key = buildPack({ inDir: renders, outDir: packDir, seed, judges: JUDGES, pairs: PAIRS, ours: OURS, casesDir: CASES });
  packState = "built";
}

// Ratings: --ratings names the pack it rates; else the current pack's judge answers, if any.
let ratedDir: string | undefined;
let ratedKey: Key | undefined;
let rater: "owner" | "panel" | undefined;
let ratingNote = "";
if (RATINGS) {
  const packId = JSON.parse(readFileSync(RATINGS, "utf8"))?.pack;
  for (const d of readdirSync(packsDir).sort(cmpStr)) {
    const k = join(packsDir, d, "sealed", "key.json");
    if (!existsSync(k)) continue;
    const kk: Key = JSON.parse(readFileSync(k, "utf8"));
    if (kk.packId === packId) { ratedDir = join(packsDir, d); ratedKey = kk; }
  }
  if (!ratedDir) ratingNote = `${RATINGS} rates pack "${packId}", which is not under ${rel(packsDir)}/`;
  else rater = "owner";
  if (ratedDir && key && ratedKey!.packId !== key.packId) ratingNote = `ratings are for ${ratedKey!.packId}, an older pack than the current drawings (${key.packId})`;
} else if (key && existsSync(join(packDir, "answers")) && readdirSync(join(packDir, "answers")).some((f) => f.endsWith(".json"))) {
  ratedDir = packDir; ratedKey = key; rater = "panel";
}

let rated: ReturnType<typeof ratedGates> | undefined;
let ratedCases: RatedCase[] = [];
if (ratedDir && ratedKey && rater) {
  const t = tally(ratedDir, RATINGS ? { owner: RATINGS, ours: OURS } : { ours: OURS });
  writeFileSync(join(ratedDir, "report.md"), t.markdown);
  writeFileSync(join(ratedDir, "report.json"), `${JSON.stringify(t.json, null, 2)}\n`);
  const per = (t.json as { perImage: Array<{ image: string; panel?: number; owner?: number }> }).perImage;
  const score = new Map(per.map((x) => [x.image, rater === "owner" ? x.owner : x.panel]));
  ratedCases = ratedCasesFrom(ratedKey, (img) => score.get(img));
  rated = ratedGates(ratedCases);
}

/** Per case: our two stages and each baseline, scored by `score` (undefined = not rated). */
function ratedCasesFrom(k: Key, score: (img: string) => number | undefined): RatedCase[] {
  const out = new Map<string, RatedCase>();
  for (const x of k.images) {
    const c = out.get(x.case) ?? { case: x.case, set: x.set === "test" ? "test" : "validation", baselines: {} };
    out.set(x.case, c);
    const s = score(x.image);
    if (x.tool === `${OURS}-noedit`) c.noEdit = s;
    else if (x.tool === `${OURS}-edit`) c.afterEdit = s;
    else if (x.tool !== OURS && !x.tool.startsWith(`${OURS}-`)) c.baselines[x.tool] = s;
  }
  return [...out.values()].sort((a, b) => cmpStr(a.case, b.case));
}

// ------------------------------------------------------------------ report

const g2v: Verdict = rated?.gate2.verdict ?? "incomplete";
const g3v: Verdict = rated?.gate3.verdict ?? "incomplete";
const g5v: Verdict = rated?.gate5.verdict ?? "incomplete";
const estimate = rater === "panel" ? " (panel estimate; SPEC defines it on the owner's ratings)" : "";
const awaiting = key ? `awaiting ratings of ${rel(packDir)}` : "no pack";
const summary = {
  mode: SET_NAME,
  gates: {
    1: { verdict: g1.verdict, figure: `${g1.pass} of ${g1.of} cases pass (need ${g1.total} of ${g1.total})` },
    2: { verdict: g2v, figure: rated ? rated.gate2.detail + estimate : awaiting },
    3: { verdict: g3v, figure: rated ? rated.gate3.detail + estimate : awaiting },
    4: { verdict: g4.verdict, figure: `${g4.pass} of ${g4.of} edit scripts pass (need ${g4.total} of ${g4.total})` },
    5: { verdict: g5v, figure: rated ? rated.gate5.detail + estimate : `${awaiting}${baselineTools.length ? "" : "; no baseline drawings"}` },
    6: { verdict: g6, figure: [...perf.map((p) => `${p.role === "generated" ? "generated" : p.role === "case 11" ? "case 11" : `stand-in ${caseId(p.name)}`} p95 ${p.p95} ms`), ...(perfNote ? [perfNote] : [])].join("; ") },
  },
  cases: cases.map((c) => ({ case: c.case, set: c.set, status: c.status, verifier: c.verifier, gate1: gate1Row(c) })),
  stages,
  edits: edits.map((e) => ({ ...e, gate4: e.gate4, gate4Verdict: e.status.startsWith("skipped") ? undefined : gate4Row(e) })),
  perf: { targetMs: PERF_TARGET_MS, runs: RUNS, note: perfNote, rows: perf },
  pack: key ? { dir: rel(packDir), packId: key.packId, seed: key.seed, state: packState, images: key.images.length, pairs: key.pairs.length, judges: key.judges.length, baselines: baselineTools, missingBaselines: baselineMissing, notes: packNotes } : { state: packState, notes: packNotes },
  ratings: rated ? { rater, pack: ratedKey?.packId, note: ratingNote, cases: ratedCases, gates: rated } : { note: ratingNote || "none" },
};
writeFileSync(join(OUT, "gates.json"), `${JSON.stringify(summary, (_k, v) => (typeof v === "string" && v.startsWith(ROOT) ? rel(v) : v), 2)}\n`);

const pad = (s: unknown, n: number) => String(s ?? "").padEnd(n);
const V = (v: Verdict) => (v === "pass" ? "PASS" : v === "fail" ? "FAIL" : "incomplete");
console.log(`Phase 0b gates, ${withTest ? "validation + test sets (end gate)" : "validation set only (default mode; the test set is not touched)"}\n`);
console.log(`${pad("gate", 5)} ${pad("verdict", 11)} figure`);
for (const [n, g] of Object.entries(summary.gates)) console.log(`${pad(n, 5)} ${pad(V(g.verdict), 11)} ${g.figure}`);

console.log(`\nGate 1: cases`);
console.log(`${pad("case", 26)} ${pad("set", 10)} ${pad("status", 22)} ${pad("verifier", 9)} gate 1`);
for (const c of cases) { const g = gate1Row(c); console.log(`${pad(c.case, 26)} ${pad(c.set, 10)} ${pad(c.status, 22)} ${pad(c.verifier ?? "-", 9)} ${g.pass ? "pass" : "FAIL"}${g.pass ? "" : ` (${g.why})`}`); }

console.log(`\nGate 4: edit scripts`);
console.log(`${pad("script", 22)} ${pad("status", 26)} ${pad("mode", 19)} gate 4`);
for (const e of edits) {
  if (e.status.startsWith("skipped") || e.status === "no such script") { console.log(`${pad(e.script, 22)} ${e.status}`); continue; }
  const g = gate4Row(e);
  const fig = e.gate4 ? ` untouched ${e.gate4.untouched}, mean ${e.gate4.meanMove} G, max ${e.gate4.maxMove} G, other routes ${e.gate4.routesOther.length}` : "";
  console.log(`${pad(e.script, 22)} ${pad(e.status, 26)} ${pad(e.mode ?? "-", 19)} ${g.pass ? "pass" : "FAIL"}${fig}${g.pass && !e.gate4 ? ` (${g.why})` : ""}${g.pass ? "" : ` (${g.why})`}`);
}

console.log(`\nGate 6: full pipeline (layout, checks, findings with fix dry-runs), 1 cold + ${RUNS} warm runs, target warm p95 < ${PERF_TARGET_MS} ms`);
console.log(`${pad("circuit", 34)} ${pad("role", 21)} ${pad("parts", 5)} ${pad("pins", 4)} ${pad("nets", 4)} ${pad("text", 5)} ${pad("finds", 5)} ${pad("status", 21)} ${pad("cold", 6)} ${pad("median", 6)} ${pad("p95", 6)} ${pad("layout", 6)} verdict`);
for (const p of perf) console.log(`${pad(p.name, 34)} ${pad(p.role, 21)} ${pad(p.parts, 5)} ${pad(p.pins, 4)} ${pad(p.nets, 4)} ${pad(p.textChars, 5)} ${pad(p.findings, 5)} ${pad(p.status, 21)} ${pad(p.coldMs, 6)} ${pad(p.median, 6)} ${pad(p.p95, 6)} ${pad(p.layoutMedianMs, 6)} ${p.role === "stand-in for case 11" ? (p.pass ? "(meets target)" : "(misses target)") : p.pass ? "pass" : "FAIL"}`);
if (perfNote) console.log(`  ${perfNote}`);

console.log(`\nGates 2, 3, 5: drawings for the blind pack`);
console.log(`${pad("case", 26)} ${pad("edit call", 9)} ${pad("findings", 8)} ${pad("outcome", 26)} ${pad("after status", 21)} ops`);
for (const s of stages) {
  console.log(`${pad(s.case, 26)} ${pad(s.source, 9)} ${pad(`${s.fixes}/${s.findings}`, 8)} ${pad(s.outcome, 26)} ${pad(s.afterStatus ?? "-", 21)} ${s.ops.map((o) => o.op + ("part" in o ? ` ${o.part}` : "")).join(", ") || "-"}`);
  if (s.outcome === "invalid call" || s.outcome.startsWith("rejected")) for (const i of s.issues.slice(0, 3)) console.log(`    ${i}`);
}
if (key) console.log(`pack ${key.packId} (${packState}): ${key.images.length} images, ${key.pairs.length} pairs, ${key.judges.length} judge prompts, seed ${key.seed}; baselines: ${baselineTools.join(", ") || "none"}\n  ${rel(packDir)}/pack/ for the judges; key in sealed/ (never show it to a judge)`);
for (const n of packNotes) console.log(`  ${n}`);
if (baselineMissing.length && baselineTools.length) console.log(`  missing baseline drawings: ${baselineMissing.join(", ")}`);
if (rated) {
  console.log(`\nRatings (${rater}${estimate}) of ${ratedKey!.packId}; report in ${rel(ratedDir!)}/report.md`);
  console.log(`${pad("case", 8)} ${pad("set", 10)} ${pad("no edit", 7)} ${pad("after", 5)} baselines`);
  for (const c of ratedCases) console.log(`${pad(c.case, 8)} ${pad(c.set, 10)} ${pad(c.noEdit ?? "-", 7)} ${pad(c.afterEdit ?? "-", 5)} ${Object.entries(c.baselines).map(([t, s]) => `${t} ${s ?? "-"}`).join(", ") || "-"}`);
}
if (ratingNote) console.log(`  ${ratingNote}`);
console.log(`\nwrote ${rel(OUT)}/ (gates.json, drawings, findings, edits, renders, packs)`);

const anyFail = [g1.verdict, g2v, g3v, g4.verdict, g5v, g6].includes("fail");
process.exitCode = anyFail || crashed ? 1 : 0;
