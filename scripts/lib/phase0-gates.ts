/** Machine-checkable Phase 0b gates. Ratings and benchmarks require separate evidence. */
export interface CaseEvidence {
  case: string;
  status: string;
  verifier?: string;
  overlaps?: number;
}

export interface EditEvidence {
  script: string;
  status: string;
  asExpected?: boolean;
  layout?: string;
  gate4?: { pass: boolean; breaks: string[] };
  issues: string[];
}

export interface Gate {
  gate: number;
  status: "pass" | "fail" | "incomplete";
  evaluated: number;
  required: number;
  failures: string[];
  reason?: string;
}

export function phase0Gates(cases: CaseEvidence[], edits: EditEvidence[], withTest: boolean): Gate[] {
  const count = withTest ? 12 : 8;
  const caseFailures: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `case${String(i).padStart(2, "0")}-`;
    const rows = cases.filter((c) => c.case.startsWith(id));
    if (rows.length !== 1) { caseFailures.push(`${id}: expected one result, got ${rows.length}`); continue; }
    const c = rows[0]!;
    const allowed = c.status === "valid" || (i === 8 && c.status === "valid_low_confidence");
    if (!allowed || c.verifier !== "valid" || c.overlaps !== 0) caseFailures.push(`${c.case}: ${c.status}; verifier ${c.verifier ?? "missing"}; overlaps ${c.overlaps ?? "missing"}`);
  }
  const editFailures: string[] = [];
  const editCases = ["03", "05", "07", ...(withTest ? ["11"] : [])];
  for (const c of editCases) for (const kind of ["longer-value", "add-part", "remove-part", "pin-sides"]) {
    const id = `case${c}-${kind}`;
    const rows = edits.filter((e) => e.script === id);
    if (rows.length !== 1) { editFailures.push(`${id}: expected one result, got ${rows.length}`); continue; }
    const e = rows[0]!;
    // SPEC 15 explicitly permits this fixed-symbol edit to be refused with no movement.
    const allowedRejection = id === "case03-pin-sides" && e.asExpected === true && e.status === "rejected (invalid_input)" && e.issues.some((s) => s.startsWith("E270 "));
    if (allowedRejection) continue;
    if (e.status !== "saved" || e.asExpected !== true || !e.layout?.startsWith("valid") || !e.gate4?.pass) {
      editFailures.push(`${id}: ${e.status}; expected result ${e.asExpected ?? "missing"}; ${e.gate4?.breaks.join("; ") || "missing or failed stability evidence"}`);
    }
  }
  const measured = (gate: number, evaluated: number, required: number, failures: string[]): Gate => ({
    gate, status: failures.length ? "fail" : withTest ? "pass" : "incomplete", evaluated, required, failures,
    ...(!withTest ? { reason: "Validation subset only; reserved test cases have not been evaluated." } : {}),
  });
  const pending = (gate: number, reason: string): Gate => ({ gate, status: "incomplete", evaluated: 0, required: gate === 6 ? 2 : gate === 3 ? 8 : 12, failures: [], reason });
  return [
    measured(1, count, 12, caseFailures),
    pending(2, "Blind owner ratings before and after the permitted agent edit are not collected by this runner."),
    pending(3, "Validation-set blind owner ratings are not collected by this runner."),
    measured(4, editCases.length * 4, 16, editFailures),
    pending(5, "Blind owner comparisons with the baselines are not collected by this runner."),
    pending(6, "Full-pipeline warm p95 benchmarks on case 11 and a generated 30-part circuit are not collected by this runner."),
  ];
}
