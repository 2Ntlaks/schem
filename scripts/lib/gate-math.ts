// SPEC 15 Phase 0b gate arithmetic, kept pure so it can be tested on synthetic numbers
// (tests/gates.test.ts). scripts/gates.ts gathers the measurements and calls these.
//
// Every gate is "at least k of n". A run that has not measured every item (the default mode runs
// the validation set only; ratings may not exist yet) still decides a gate when the missing items
// cannot change the outcome: `pass` once the count is reached, `fail` once it can no longer be
// reached, otherwise `incomplete`.

export type Verdict = "pass" | "fail" | "incomplete";

export const FULL = { validation: 8, test: 4, cases: 12, editScripts: 16 } as const;

/** Decide "at least `need` of `total`" from `yes` successes among `known` measured items. */
export function atLeast(yes: number, known: number, total: number, need: number): Verdict {
  if (yes >= need) return "pass";
  const unknown = Math.max(0, total - known);
  return yes + unknown < need ? "fail" : "incomplete";
}

/** Combine verdicts that must all pass. */
export function all(...vs: Verdict[]): Verdict {
  if (vs.includes("fail")) return "fail";
  return vs.every((v) => v === "pass") ? "pass" : "incomplete";
}

/** "case08-diffpair" -> 8; undefined when the name does not start with caseNN. */
export function caseNumber(name: string): number | undefined {
  const m = /^case(\d{2})/.exec(name);
  return m ? Number(m[1]) : undefined;
}

// ------------------------------------------------------------------ gate 1

export interface Gate1Row { case: string; status: string; verifier?: "valid" | "INVALID" }
/** Cases on which `valid_low_confidence` is allowed (SPEC 15 gate 1: case 8 only). */
export const LOW_CONFIDENCE_ALLOWED = new Set([8]);

export function gate1Row(r: Gate1Row): { pass: boolean; why: string } {
  if (r.verifier !== "valid") return { pass: false, why: r.verifier ? "verifier rejects the drawing" : `no drawing (${r.status})` };
  if (r.status === "valid") return { pass: true, why: "valid" };
  if (r.status === "valid_low_confidence") {
    const n = caseNumber(r.case);
    return n !== undefined && LOW_CONFIDENCE_ALLOWED.has(n)
      ? { pass: true, why: "valid_low_confidence (allowed on case 8)" }
      : { pass: false, why: "valid_low_confidence (allowed on case 8 only)" };
  }
  return { pass: false, why: `status ${r.status}` };
}

export function gate1(rows: Gate1Row[], total: number = FULL.cases): { verdict: Verdict; pass: number; of: number; total: number } {
  const pass = rows.filter((r) => gate1Row(r).pass).length;
  return { verdict: atLeast(pass, rows.length, total, total), pass, of: rows.length, total };
}

// ------------------------------------------------------------------ gate 4

export interface Gate4Row { script: string; status: string; gate4?: { pass: boolean; breaks: string[] } }

/**
 * One edit script against gate 4. A saved edit passes when its change report has no breaks. A rejected
 * edit fails, except case 3's `setPinSides` on the fixed op-amp symbol, which SPEC 15 counts as a pass
 * with nothing moved.
 */
export function gate4Row(e: Gate4Row): { pass: boolean; why: string } {
  if (e.status === "saved") {
    if (!e.gate4) return { pass: false, why: "saved, but no change report" };
    return e.gate4.pass ? { pass: true, why: "stable" } : { pass: false, why: e.gate4.breaks.join("; ") };
  }
  if (e.status.startsWith("rejected") && caseNumber(e.script) === 3 && /-pin-sides$/.test(e.script))
    return { pass: true, why: "rejected setPinSides on case 3 (counts as a pass, nothing moved)" };
  return { pass: false, why: e.status };
}

export function gate4(rows: Gate4Row[], total: number = FULL.editScripts): { verdict: Verdict; pass: number; of: number; total: number } {
  const pass = rows.filter((r) => gate4Row(r).pass).length;
  return { verdict: atLeast(pass, rows.length, total, total), pass, of: rows.length, total };
}

// ------------------------------------------------------------------ gates 2, 3, 5 (ratings)

/** One frozen case's ratings: our two stages and each baseline that has a drawing (1-5, 4 = would publish). */
export interface RatedCase {
  case: string;
  set: "validation" | "test";
  noEdit?: number;
  afterEdit?: number;
  baselines: Record<string, number | undefined>;
}

export interface RatedGate { verdict: Verdict; yes: number; known: number; total: number; need: number; detail: string }

/**
 * SPEC 15 gate 2: after-edit 4+ on at least 9 of 12, including at least 3 of the 4 test cases.
 * Gate 3: after-edit 4+ on at least 7 of the 8 validation cases.
 * Gate 5: our after-edit drawing rated >= the best baseline on at least 8 of 12. A case counts as
 * measured once ours and at least one baseline are rated.
 * The no-edit figure ("recorded twice") is reported beside gate 2; it decides nothing.
 */
export function ratedGates(cases: RatedCase[], full: { validation: number; test: number } = FULL): {
  gate2: RatedGate & { test: { yes: number; known: number; total: number; need: number }; noEdit: { yes: number; known: number } };
  gate3: RatedGate;
  gate5: RatedGate;
} {
  const total = full.validation + full.test;
  const rated = cases.filter((c) => c.afterEdit !== undefined);
  const yes = rated.filter((c) => c.afterEdit! >= 4).length;
  const testRated = rated.filter((c) => c.set === "test");
  const testYes = testRated.filter((c) => c.afterEdit! >= 4).length;
  const valRated = rated.filter((c) => c.set === "validation");
  const valYes = valRated.filter((c) => c.afterEdit! >= 4).length;
  const noEditRated = cases.filter((c) => c.noEdit !== undefined);
  const testNeed = Math.ceil((3 / 4) * full.test);
  const gate2Need = Math.ceil((9 / 12) * total);

  const g2 = all(atLeast(yes, rated.length, total, gate2Need), atLeast(testYes, testRated.length, full.test, testNeed));
  const vsBest = cases.flatMap((c) => {
    const b = Object.values(c.baselines).filter((x): x is number => x !== undefined);
    return c.afterEdit !== undefined && b.length ? [c.afterEdit >= Math.max(...b)] : [];
  });
  const g5Yes = vsBest.filter(Boolean).length;
  const g5Need = Math.ceil((8 / 12) * total);
  const g3Need = Math.ceil((7 / 8) * full.validation);
  return {
    gate2: {
      verdict: g2, yes, known: rated.length, total, need: gate2Need,
      detail: `after-edit 4+ on ${yes} of ${rated.length} rated (need ${gate2Need} of ${total}); test ${testYes} of ${testRated.length} rated (need ${testNeed} of ${full.test}); no-edit 4+ on ${noEditRated.filter((c) => c.noEdit! >= 4).length} of ${noEditRated.length}`,
      test: { yes: testYes, known: testRated.length, total: full.test, need: testNeed },
      noEdit: { yes: noEditRated.filter((c) => c.noEdit! >= 4).length, known: noEditRated.length },
    },
    gate3: {
      verdict: atLeast(valYes, valRated.length, full.validation, g3Need), yes: valYes, known: valRated.length, total: full.validation, need: g3Need,
      detail: `validation after-edit 4+ on ${valYes} of ${valRated.length} rated (need ${g3Need} of ${full.validation})`,
    },
    gate5: {
      verdict: atLeast(g5Yes, vsBest.length, total, g5Need), yes: g5Yes, known: vsBest.length, total, need: g5Need,
      detail: `after-edit >= best baseline on ${g5Yes} of ${vsBest.length} cases with ratings for both (need ${g5Need} of ${total})`,
    },
  };
}

// ------------------------------------------------------------------ gate 6

/** Nearest-rank percentile (p in 0-100) of a non-empty sample. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[Math.min(rank, s.length) - 1]!;
}

/** SPEC 13 item 11: 30 parts, up to 150 pins, full pipeline, warm p95 under 3 s. */
export const PERF_TARGET_MS = 3000;

export function perfVerdict(warmMs: readonly number[], targetMs = PERF_TARGET_MS): { median: number; p95: number; pass: boolean } {
  const median = percentile(warmMs, 50), p95 = percentile(warmMs, 95);
  return { median, p95, pass: warmMs.length > 0 && p95 < targetMs };
}
