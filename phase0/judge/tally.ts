// Tally the judges' answers against the sealed key.
//
//   npx tsx phase0/judge/tally.ts --dir <pack output folder> [--owner owner.json] [--ours schem[,name...]] [--json report.json]
//
// Reads <dir>/sealed/key.json and every <dir>/answers/*.json (one per judge). --owner adds the owner's ratings
// (same JSON shape, any "judge" value) for calibration and for the SPEC 15 gate figures as the spec defines them.
// Prints a Markdown report; --json also writes the numbers.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Key } from "./blind-pack.js";
import { cmpStr, fmt, mean, median, oursMatcher, parseArgs, pct, sd } from "./lib.js";

export type Level = "good" | "minor" | "major" | "n/a";
export const CHECKLIST = ["connections", "overlaps", "supplyGround", "flow", "crossings", "junctions", "labels", "spacing", "symmetry", "wiring"] as const;

export interface Answer {
  judge: string;
  pack: string;
  absolute: Array<{ image: string; connections: { correct: boolean; errors: string[] }; checklist?: Partial<Record<string, Level>>; score: number; notes?: string }>;
  pairwise: Array<{ pair: string; choice: "A" | "B" | "tie"; reason?: string }>;
}

/** One judge's ratings after checking: score per image (incorrect forced to 1), choice per pair. */
export interface Rater { id: string; scores: Map<string, number>; correct: Map<string, boolean>; choices: Map<string, "A" | "B" | "tie">; problems: string[]; levels: Map<string, Partial<Record<string, Level>>> }

export function checkAnswer(ans: Answer, key: Key, label: string, requirePairs = true): Rater {
  const problems: string[] = [];
  const r: Rater = { id: String(ans?.judge ?? label), scores: new Map(), correct: new Map(), choices: new Map(), problems, levels: new Map() };
  if (ans?.pack !== key.packId) problems.push(`pack is "${ans?.pack}", expected "${key.packId}"`);
  const images = new Set(key.images.map((x) => x.image));
  for (const e of ans?.absolute ?? []) {
    const img = String(e.image ?? "").replace(/^images\//, "");
    if (!images.has(img)) { problems.push(`unknown image "${e.image}"`); continue; }
    if (r.scores.has(img)) { problems.push(`${img} rated twice; first rating kept`); continue; }
    let s = e.score;
    if (!Number.isInteger(s) || s < 1 || s > 5) { problems.push(`${img}: score ${JSON.stringify(s)} is not an integer 1-5; ignored`); continue; }
    const ok = e.connections?.correct;
    if (typeof ok !== "boolean") problems.push(`${img}: connections.correct missing; taken as true`);
    if (ok === false && s !== 1) { problems.push(`${img}: incorrect drawing scored ${s}; rubric forces 1`); s = 1; }
    if (ok === false && !(e.connections.errors ?? []).length) problems.push(`${img}: incorrect but no errors listed`);
    for (const [k, v] of Object.entries(e.checklist ?? {})) {
      if (!(CHECKLIST as readonly string[]).includes(k)) problems.push(`${img}: unknown checklist key "${k}"`);
      if (!["good", "minor", "major", "n/a"].includes(v as string)) problems.push(`${img}: checklist ${k} = "${v}"`);
    }
    r.scores.set(img, s);
    r.correct.set(img, ok !== false);
    r.levels.set(img, e.checklist ?? {});
  }
  for (const img of images) if (!r.scores.has(img)) problems.push(`${img} not rated`);
  const pairIds = new Set(key.pairs.map((p) => p.pair));
  for (const p of ans?.pairwise ?? []) {
    if (!pairIds.has(p.pair)) { problems.push(`unknown pair "${p.pair}"`); continue; }
    if (p.choice !== "A" && p.choice !== "B" && p.choice !== "tie") { problems.push(`${p.pair}: choice "${p.choice}" is not A, B or tie; ignored`); continue; }
    r.choices.set(p.pair, p.choice);
  }
  const missing = [...pairIds].filter((id) => !r.choices.has(id));
  if (requirePairs) for (const id of missing) problems.push(`${id} not answered`);
  return r;
}

// ------------------------------------------------------------------ agreement statistics

/**
 * Within-case ranking agreement of two raters: over every pair of images of the same case that both raters
 * score differently (no tie from either), the share they order the same way. This is the question the gates
 * ask ("is ours at least as good as the baseline on this case?"), and it is unaffected by one judge being
 * harsher overall. Pairs tied by either rater are counted separately.
 */
export function rankAgreement(a: Map<string, number>, b: Map<string, number>, key: Key): { agree: number; comparable: number; ties: number } {
  let agree = 0, comparable = 0, ties = 0;
  const byCase = new Map<string, string[]>();
  for (const x of key.images) byCase.set(x.case, [...(byCase.get(x.case) ?? []), x.image]);
  for (const imgs of byCase.values()) for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) {
    const ai = a.get(imgs[i]!), aj = a.get(imgs[j]!), bi = b.get(imgs[i]!), bj = b.get(imgs[j]!);
    if (ai === undefined || aj === undefined || bi === undefined || bj === undefined) continue;
    const sa = Math.sign(ai - aj), sb = Math.sign(bi - bj);
    if (sa === 0 || sb === 0) { ties++; continue; }
    comparable++;
    if (sa === sb) agree++;
  }
  return { agree, comparable, ties };
}

/**
 * Fleiss' kappa for the "would publish" verdict (score >= 4) across all raters: agreement beyond chance on
 * the decision the gates count. 1 = perfect, 0 = chance, < 0 = worse than chance. Images not rated by every
 * rater are left out.
 */
export function fleissKappa(raters: Rater[], images: string[]): { kappa: number; items: number } {
  const n = raters.length;
  const rows: Array<[number, number]> = [];
  for (const img of images) {
    const s = raters.map((r) => r.scores.get(img));
    if (s.some((x) => x === undefined)) continue;
    const yes = s.filter((x) => x! >= 4).length;
    rows.push([yes, n - yes]);
  }
  const N = rows.length;
  if (N === 0 || n < 2) return { kappa: NaN, items: N };
  const pYes = rows.reduce((a, r) => a + r[0], 0) / (N * n);
  const pe = pYes ** 2 + (1 - pYes) ** 2;
  const pbar = rows.reduce((a, [y, no]) => a + (y * (y - 1) + no * (no - 1)) / (n * (n - 1)), 0) / N;
  return { kappa: pe === 1 ? (pbar === 1 ? 1 : NaN) : (pbar - pe) / (1 - pe), items: N };
}

/** Cohen's kappa of two raters on "would publish". */
export function cohenKappa(a: Map<string, number>, b: Map<string, number>): { kappa: number; items: number; agree: number } {
  let n = 0, agree = 0, ay = 0, by = 0;
  for (const [img, x] of a) {
    const y = b.get(img);
    if (y === undefined) continue;
    n++;
    const px = x >= 4, py = y >= 4;
    if (px === py) agree++;
    if (px) ay++;
    if (py) by++;
  }
  if (!n) return { kappa: NaN, items: 0, agree: 0 };
  const po = agree / n, pe = (ay / n) * (by / n) + (1 - ay / n) * (1 - by / n);
  return { kappa: pe === 1 ? (po === 1 ? 1 : NaN) : (po - pe) / (1 - pe), items: n, agree };
}

// ------------------------------------------------------------------ report

interface GateFigures { rater: string; tool: string; cases: number; pass4: number; testCases: number; testPass4: number; valCases: number; valPass4: number; vsBest: number; vsBestOf: number; gate2: boolean; gate3: boolean; gate5: boolean }

/** SPEC 15 gate figures for one of our tools from a score per image (panel median or the owner's score). */
export function gateFigures(score: (img: string) => number | undefined, key: Key, tool: string, raterName: string, isOurs: (t: string) => boolean): GateFigures {
  const cases = [...new Set(key.images.filter((x) => x.tool === tool).map((x) => x.case))].sort(cmpStr);
  let pass4 = 0, testCases = 0, testPass4 = 0, valCases = 0, valPass4 = 0, vsBest = 0, vsBestOf = 0;
  for (const c of cases) {
    const mine = key.images.find((x) => x.tool === tool && x.case === c)!;
    const s = score(mine.image);
    if (s === undefined) continue;
    const ok = s >= 4;
    if (ok) pass4++;
    if (mine.set === "test") { testCases++; if (ok) testPass4++; } else { valCases++; if (ok) valPass4++; }
    const base = key.images.filter((x) => x.case === c && !isOurs(x.tool)).map((x) => score(x.image)).filter((x): x is number => x !== undefined);
    if (base.length) { vsBestOf++; if (s >= Math.max(...base)) vsBest++; }
  }
  return {
    rater: raterName, tool, cases: cases.length, pass4, testCases, testPass4, valCases, valPass4, vsBest, vsBestOf,
    gate2: pass4 >= 9 && testPass4 >= 3, gate3: valPass4 >= 7, gate5: vsBest >= 8,
  };
}

export function tally(dir: string, opts: { owner?: string; ours?: string } = {}): { markdown: string; json: unknown } {
  const key: Key = JSON.parse(readFileSync(join(dir, "sealed", "key.json"), "utf8"));
  const oursPrefix = opts.ours ?? key.ours ?? "schem";
  const isOurs = oursMatcher(oursPrefix);
  const ansDir = join(dir, "answers");
  const files = existsSync(ansDir) ? readdirSync(ansDir).filter((f) => f.endsWith(".json")).sort(cmpStr) : [];
  const raters: Rater[] = [];
  const load = (path: string, label: string, requirePairs = true): Rater => {
    let ans: Answer;
    try { ans = JSON.parse(readFileSync(path, "utf8")); } catch (e: any) { return { id: label, scores: new Map(), correct: new Map(), choices: new Map(), levels: new Map(), problems: [`cannot read JSON: ${e.message}`] }; }
    return checkAnswer(ans, key, label, requirePairs);
  };
  for (const f of files) raters.push(load(join(ansDir, f), f.replace(/\.json$/, "")));
  const owner = opts.owner ? load(opts.owner, "owner", false) : undefined; // the owner may skip the pairwise part
  if (owner) owner.id = "owner";
  const out: string[] = [];
  const md = (s = "") => out.push(s);
  const imgInfo = new Map(key.images.map((x) => [x.image, x]));
  const panel = new Map<string, number>();
  for (const x of key.images) {
    const s = raters.map((r) => r.scores.get(x.image)).filter((v): v is number => v !== undefined);
    if (s.length) panel.set(x.image, median(s));
  }

  md(`# Judge tally: ${key.packId}`);
  md();
  md(`${raters.length} judge answer file(s), ${key.images.length} images, ${key.pairs.length} pairs, seed ${key.seed}. Our tools: ${oursPrefix} (exact, or name-stage). Panel score = median of the judges' scores (incorrect drawings count as 1).`);
  md();
  const problems = [...raters, ...(owner ? [owner] : [])].filter((r) => r.problems.length);
  if (problems.length) {
    md("## Answer problems");
    md();
    for (const r of problems) { md(`- **${r.id}**: ${r.problems.length} problem(s)`); for (const p of r.problems.slice(0, 20)) md(`  - ${p}`); if (r.problems.length > 20) md(`  - ... ${r.problems.length - 20} more`); }
    md();
  }

  // Per image
  md("## Per image");
  md();
  md(`| Image | Tool | Case | Set | Scores | Mean | Spread (min-max) | SD | Panel | Judged incorrect |${owner ? " Owner |" : ""}`);
  md(`|---|---|---|---|---|---|---|---|---|---|${owner ? "---|" : ""}`);
  const perImage: unknown[] = [];
  for (const x of [...key.images].sort((a, b) => cmpStr(a.case, b.case) || cmpStr(a.tool, b.tool))) {
    const s = raters.map((r) => r.scores.get(x.image)).filter((v): v is number => v !== undefined);
    const wrong = raters.filter((r) => r.correct.get(x.image) === false).length;
    const o = owner?.scores.get(x.image);
    perImage.push({ image: x.image, tool: x.tool, case: x.case, set: x.set, scores: s, mean: mean(s), min: Math.min(...s), max: Math.max(...s), sd: sd(s), panel: panel.get(x.image), incorrectVotes: wrong, owner: o });
    md(`| ${x.image} | ${x.tool} | ${x.case} | ${x.set} | ${s.join(" ")} | ${fmt(mean(s))} | ${s.length ? `${Math.min(...s)}-${Math.max(...s)}` : "-"} | ${fmt(sd(s))} | ${fmt(panel.get(x.image) ?? NaN, 1)} | ${wrong}/${raters.length} |${owner ? ` ${o ?? "-"} |` : ""}`);
  }
  md();

  // Per tool
  const tools = [...new Set(key.images.map((x) => x.tool))].sort(cmpStr);
  md("## Per tool");
  md();
  md("| Tool | Images | Mean panel score | Panel 4+ | Majority says incorrect | Pairwise wins / losses / ties |");
  md("|---|---|---|---|---|---|");
  const pairMajority = new Map<string, "A" | "B" | "tie">();
  for (const p of key.pairs) {
    const votes = raters.map((r) => r.choices.get(p.pair)).filter((v): v is "A" | "B" | "tie" => v !== undefined);
    const a = votes.filter((v) => v === "A").length, b = votes.filter((v) => v === "B").length;
    if (votes.length) pairMajority.set(p.pair, a > b ? "A" : b > a ? "B" : "tie");
  }
  const perTool: unknown[] = [];
  for (const t of tools) {
    const imgs = key.images.filter((x) => x.tool === t);
    const ps = imgs.map((x) => panel.get(x.image)).filter((v): v is number => v !== undefined);
    const wrongMaj = imgs.filter((x) => raters.filter((r) => r.correct.get(x.image) === false).length * 2 > raters.length).length;
    let w = 0, l = 0, ti = 0;
    for (const p of key.pairs) {
      const m = pairMajority.get(p.pair);
      if (!m) continue;
      const side = p.a.tool === t ? "A" : p.b.tool === t ? "B" : undefined;
      if (!side) continue;
      if (m === "tie") ti++; else if (m === side) w++; else l++;
    }
    perTool.push({ tool: t, images: imgs.length, meanPanel: mean(ps), panel4: ps.filter((s) => s >= 4).length, majorityIncorrect: wrongMaj, pairwise: { wins: w, losses: l, ties: ti } });
    md(`| ${t}${isOurs(t) ? " (ours)" : ""} | ${imgs.length} | ${fmt(mean(ps))} | ${ps.filter((s) => s >= 4).length}/${ps.length} | ${wrongMaj} | ${w} / ${l} / ${ti} |`);
  }
  md();

  // Per case
  const cases = [...new Set(key.images.map((x) => x.case))].sort(cmpStr);
  md("## Per case (panel scores)");
  md();
  md(`| Case | Set | ${tools.join(" | ")} | Best baseline |`);
  md(`|---|---|${tools.map(() => "---|").join("")}---|`);
  for (const c of cases) {
    const set = key.images.find((x) => x.case === c)!.set;
    const cells = tools.map((t) => { const x = key.images.find((y) => y.tool === t && y.case === c); return x ? fmt(panel.get(x.image) ?? NaN, 1) : "-"; });
    const base = key.images.filter((x) => x.case === c && !isOurs(x.tool)).map((x) => panel.get(x.image)).filter((v): v is number => v !== undefined);
    md(`| ${c} | ${set} | ${cells.join(" | ")} | ${base.length ? fmt(Math.max(...base), 1) : "-"} |`);
  }
  md();

  // Agreement
  md("## Agreement between judges");
  md();
  const agreeRows: unknown[] = [];
  if (raters.length >= 2) {
    let ag = 0, cmp = 0, ti = 0, exact = 0, within1 = 0, both = 0;
    md("| Judges | Within-case order agrees | Comparable pairs | Tied pairs | Same score | Within 1 point | Publish verdict agrees (Cohen's kappa) |");
    md("|---|---|---|---|---|---|---|");
    for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) {
      const a = raters[i]!, b = raters[j]!;
      const r = rankAgreement(a.scores, b.scores, key);
      let e = 0, w1 = 0, n = 0;
      for (const [img, s] of a.scores) { const t = b.scores.get(img); if (t === undefined) continue; n++; if (s === t) e++; if (Math.abs(s - t) <= 1) w1++; }
      const ck = cohenKappa(a.scores, b.scores);
      ag += r.agree; cmp += r.comparable; ti += r.ties; exact += e; within1 += w1; both += n;
      agreeRows.push({ a: a.id, b: b.id, ...r, sameScore: e, within1: w1, items: n, cohenKappa: ck.kappa });
      md(`| ${a.id} / ${b.id} | ${pct(r.agree, r.comparable)} | ${r.comparable} | ${r.ties} | ${pct(e, n)} | ${pct(w1, n)} | ${pct(ck.agree, ck.items)} (${fmt(ck.kappa)}) |`);
    }
    const fk = fleissKappa(raters, key.images.map((x) => x.image));
    md();
    md(`- **Within-case order agreement, all judge pairs: ${pct(ag, cmp)}** of ${cmp} comparable image pairs (${ti} pairs tied by at least one judge, left out). This is the main agreement figure: it measures whether judges agree which drawing of a circuit is better, which is what gate 5 asks, and a judge who is harsher across the board does not lower it.`);
    md(`- Same score: ${pct(exact, both)}; within one point: ${pct(within1, both)}.`);
    md(`- **Fleiss' kappa on "would publish" (score 4+): ${fmt(fk.kappa)}** over ${fk.items} images (1 = perfect, 0 = chance). This covers the 4+ counts of gates 2 and 3.`);
    if (key.pairs.length) {
      let agreeMaj = 0, votesN = 0, selfConsistent = 0, selfN = 0;
      for (const p of key.pairs) {
        const m = pairMajority.get(p.pair);
        for (const r of raters) {
          const c = r.choices.get(p.pair);
          if (c === undefined) continue;
          votesN++;
          if (c === m) agreeMaj++;
          const sa = r.scores.get(p.a.image), sb = r.scores.get(p.b.image);
          if (sa !== undefined && sb !== undefined && sa !== sb) { selfN++; if ((sa > sb ? "A" : "B") === c) selfConsistent++; }
        }
      }
      md(`- Pairwise mode: ${pct(agreeMaj, votesN)} of choices match the pair's majority. Judges' pairwise choices agree with their own absolute scores in ${pct(selfConsistent, selfN)} of ${selfN} pairs they scored differently.`);
    }
  } else md("Fewer than two judges: no agreement figures.");
  md();

  // Gates
  md("## SPEC 15 gate figures");
  md();
  md("Gates 2, 3 and 5 are defined on the **owner's** blind ratings. Rows marked *panel* are the judges' estimate of them; rows marked *owner* are the gate as specified. Gate 2 needs ratings both without edits and after one agent edit call, so pack each stage as its own tool (for example `schem-noedit` and `schem-edit`) and read each row separately.");
  md();
  md("| Rater | Tool | Cases | 4+ (gate 2: >= 9 of 12) | Test 4+ (>= 3 of 4) | Validation 4+ (gate 3: >= 7 of 8) | >= best baseline (gate 5: >= 8 of 12) |");
  md("|---|---|---|---|---|---|---|");
  const gates: GateFigures[] = [];
  for (const t of tools.filter(isOurs)) {
    gates.push(gateFigures((img) => panel.get(img), key, t, "panel", isOurs));
    if (owner) gates.push(gateFigures((img) => owner.scores.get(img), key, t, "owner", isOurs));
  }
  const yes = (b: boolean, n: number, full: number) => (n === full ? (b ? " pass" : " **fail**") : ` (only ${n} of ${full} cases in pack)`);
  for (const g of gates) {
    md(`| ${g.rater} | ${g.tool} | ${g.cases} | ${g.pass4}/${g.cases}${yes(g.gate2, g.cases, 12)} | ${g.testPass4}/${g.testCases} | ${g.valPass4}/${g.valCases}${yes(g.gate3, g.valCases, 8)} | ${g.vsBest}/${g.vsBestOf}${yes(g.gate5, g.vsBestOf, 12)} |`);
  }
  if (!gates.length) md(`| - | no tool matches --ours ${oursPrefix} | | | | | |`);
  md();

  // Owner calibration
  let calibration: unknown[] = [];
  if (owner) {
    md("## Calibration against the owner");
    md();
    md("| Judge | Mean absolute difference | Publish verdict agrees (Cohen's kappa) | Within-case order agrees with owner |");
    md("|---|---|---|---|");
    const rows = [...raters.map((r) => ({ id: r.id, scores: r.scores })), { id: "panel (median)", scores: panel }];
    calibration = rows.map((r) => {
      const d: number[] = [];
      for (const [img, s] of r.scores) { const o = owner.scores.get(img); if (o !== undefined) d.push(Math.abs(s - o)); }
      const ck = cohenKappa(r.scores, owner.scores);
      const ra = rankAgreement(r.scores, owner.scores, key);
      md(`| ${r.id} | ${fmt(mean(d))} | ${pct(ck.agree, ck.items)} (${fmt(ck.kappa)}) | ${pct(ra.agree, ra.comparable)} of ${ra.comparable} |`);
      return { judge: r.id, meanAbsDiff: mean(d), publishAgree: ck.agree, items: ck.items, cohenKappa: ck.kappa, ...ra };
    });
    md();
    md("Images where the panel and the owner disagree on \"would publish\" (use these to tighten the rubric):");
    md();
    let any = false;
    for (const [img, o] of owner.scores) {
      const p = panel.get(img);
      if (p === undefined || (p >= 4) === (o >= 4)) continue;
      any = true;
      const x = imgInfo.get(img)!;
      md(`- ${img} (${x.tool}, ${x.case}): panel ${fmt(p, 1)}, owner ${o}`);
    }
    if (!any) md("- none");
    md();
  }

  // Checklist summary per tool
  md("## Checklist: share of judge ratings marked major, per tool");
  md();
  md(`| Tool | ${CHECKLIST.join(" | ")} |`);
  md(`|---|${CHECKLIST.map(() => "---|").join("")}`);
  for (const t of tools) {
    const imgs = key.images.filter((x) => x.tool === t).map((x) => x.image);
    const cells = CHECKLIST.map((k) => {
      let major = 0, n = 0;
      for (const r of raters) for (const img of imgs) { const v = r.levels.get(img)?.[k]; if (v && v !== "n/a") { n++; if (v === "major") major++; } }
      return pct(major, n);
    });
    md(`| ${t} | ${cells.join(" | ")} |`);
  }
  md();

  return { markdown: out.join("\n") + "\n", json: { packId: key.packId, seed: key.seed, judges: raters.map((r) => ({ id: r.id, problems: r.problems })), perImage, perTool, agreement: agreeRows, gates, calibration } };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const dir = a.get("dir");
  if (typeof dir !== "string") throw new Error("--dir <pack output folder> is required");
  const owner = a.get("owner"), ours = a.get("ours"), json = a.get("json");
  const r = tally(dir, { owner: typeof owner === "string" ? owner : undefined, ours: typeof ours === "string" ? ours : undefined });
  process.stdout.write(r.markdown);
  if (typeof json === "string") writeFileSync(json, JSON.stringify(r.json, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e: any) { console.error(`tally: ${e.message ?? e}`); process.exitCode = 1; }
}
