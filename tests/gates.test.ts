// Gate arithmetic of the Phase 0b gate runner (scripts/lib/gate-math.ts, SPEC 15) on synthetic ratings.

import { describe, expect, it } from "vitest";
import { atLeast, gate1, gate1Row, gate4, gate4Row, percentile, perfVerdict, ratedGates, type RatedCase } from "../scripts/lib/gate-math.js";

const id = (n: number) => `case${String(n).padStart(2, "0")}`;
/** Twelve cases (1-8 validation, 9-12 test) with the given after-edit scores and one baseline each. */
function cases(after: Array<number | undefined>, baseline: Array<number | undefined> = after.map(() => 3), noEdit?: number[]): RatedCase[] {
  return after.map((a, i) => ({
    case: id(i + 1), set: i < 8 ? "validation" : "test",
    ...(a !== undefined ? { afterEdit: a } : {}), ...(noEdit ? { noEdit: noEdit[i] } : {}),
    baselines: { netlistsvg: baseline[i], skidl: 2 },
  }));
}

describe("atLeast", () => {
  it("decides early only when the missing items cannot change the outcome", () => {
    expect(atLeast(7, 8, 8, 7)).toBe("pass");
    expect(atLeast(6, 8, 8, 7)).toBe("fail");
    expect(atLeast(5, 8, 12, 9)).toBe("incomplete");
    expect(atLeast(4, 8, 12, 9)).toBe("fail");
    expect(atLeast(9, 9, 12, 9)).toBe("pass");
  });
});

describe("gate 2: after-edit 4+ on at least 9 of 12, including 3 of the 4 test cases", () => {
  it("passes at 9 of 12 with 3 test cases", () => {
    const g = ratedGates(cases([4, 4, 4, 4, 4, 4, 3, 3, 4, 4, 4, 2])).gate2;
    expect([g.yes, g.test.yes, g.verdict]).toEqual([9, 3, "pass"]);
  });
  it("fails at 8 of 12", () => {
    expect(ratedGates(cases([4, 4, 4, 4, 4, 3, 3, 3, 4, 4, 4, 2])).gate2.verdict).toBe("fail");
  });
  it("fails with 10 of 12 when only 2 test cases are 4+", () => {
    const g = ratedGates(cases([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 1])).gate2;
    expect([g.yes, g.test.yes, g.verdict]).toEqual([10, 2, "fail"]);
  });
  it("uses the after-edit score, not the no-edit one", () => {
    const g = ratedGates(cases([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], undefined, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])).gate2;
    expect([g.verdict, g.noEdit.yes, g.noEdit.known]).toEqual(["pass", 0, 12]);
  });
  it("is incomplete on the validation set alone unless the result is already certain", () => {
    expect(ratedGates(cases([4, 4, 4, 4, 4, 4, 3, 3])).gate2.verdict).toBe("incomplete");
    expect(ratedGates(cases([4, 4, 4, 4, 3, 3, 3, 3])).gate2.verdict).toBe("fail"); // 4 + 4 test < 9
  });
  it("counts a 5 as 4+ and a 3 as not", () => {
    expect(ratedGates(cases([5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 3, 3])).gate2.verdict).toBe("fail"); // 1 test case
    expect(ratedGates(cases([5, 5, 5, 5, 5, 5, 3, 3, 5, 5, 5, 3])).gate2.verdict).toBe("pass");
  });
});

describe("gate 3: after-edit 4+ on at least 7 of the 8 validation cases", () => {
  it("passes at 7 of 8 and fails at 6 of 8", () => {
    expect(ratedGates(cases([4, 4, 4, 4, 4, 4, 4, 1])).gate3.verdict).toBe("pass");
    expect(ratedGates(cases([4, 4, 4, 4, 4, 4, 1, 1])).gate3.verdict).toBe("fail");
  });
  it("ignores the test cases", () => {
    const g = ratedGates(cases([4, 4, 4, 4, 4, 4, 1, 1, 5, 5, 5, 5])).gate3;
    expect([g.yes, g.known, g.verdict]).toEqual([6, 8, "fail"]);
  });
  it("is incomplete while a validation case is unrated and 7 is still reachable", () => {
    expect(ratedGates(cases([4, 4, 4, 4, 4, 4, 1, undefined])).gate3.verdict).toBe("incomplete");
  });
});

describe("gate 5: rated >= the best baseline on at least 8 of 12", () => {
  const after = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  it("counts a tie with the best baseline as a success", () => {
    const g = ratedGates(cases(after, [4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5])).gate5;
    expect([g.yes, g.known, g.verdict]).toEqual([8, 12, "pass"]);
  });
  it("fails at 7 of 12", () => {
    expect(ratedGates(cases(after, [4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5])).gate5.verdict).toBe("fail");
  });
  it("compares with the best of several baselines", () => {
    const c = cases(after);
    for (const x of c) x.baselines.skidl = 5;
    expect(ratedGates(c).gate5).toMatchObject({ yes: 0, verdict: "fail" });
  });
  it("leaves cases with no rated baseline out, and stays incomplete while 8 is reachable", () => {
    const g = ratedGates(cases(after, after.map((_, i) => (i < 6 ? 3 : undefined))).map((x) => ({ ...x, baselines: { netlistsvg: x.baselines.netlistsvg } }))).gate5;
    expect([g.yes, g.known, g.verdict]).toEqual([6, 6, "incomplete"]);
  });
});

describe("gate 1", () => {
  it("allows valid_low_confidence on case 8 only and needs the verifier", () => {
    expect(gate1Row({ case: "case08-diffpair", status: "valid_low_confidence", verifier: "valid" }).pass).toBe(true);
    expect(gate1Row({ case: "case04-hbridge", status: "valid_low_confidence", verifier: "valid" }).pass).toBe(false);
    expect(gate1Row({ case: "case01-led", status: "INVALID (verifier)", verifier: "INVALID" }).pass).toBe(false);
    expect(gate1Row({ case: "case01-led", status: "budget_exhausted" }).pass).toBe(false);
  });
  it("needs 12 of 12", () => {
    const ok = Array.from({ length: 8 }, (_, i) => ({ case: id(i + 1), status: "valid", verifier: "valid" as const }));
    expect(gate1(ok).verdict).toBe("incomplete");
    expect(gate1([...ok, ...[9, 10, 11, 12].map((n) => ({ case: id(n), status: "valid", verifier: "valid" as const }))]).verdict).toBe("pass");
    expect(gate1([{ ...ok[0]!, status: "budget_exhausted" }, ...ok.slice(1)]).verdict).toBe("fail");
  });
});

describe("gate 4", () => {
  it("passes stable saved edits and only case 3's rejected setPinSides", () => {
    expect(gate4Row({ script: "case03-pin-sides", status: "rejected (invalid_input)" }).pass).toBe(true);
    expect(gate4Row({ script: "case05-pin-sides", status: "rejected (invalid_input)" }).pass).toBe(false);
    expect(gate4Row({ script: "case03-add-part", status: "rejected (budget_exhausted)" }).pass).toBe(false);
    expect(gate4Row({ script: "case05-add-part", status: "saved", gate4: { pass: false, breaks: ["max 7 G"] } }).pass).toBe(false);
    const rows = Array.from({ length: 12 }, (_, i) => ({ script: `s${i}`, status: "saved", gate4: { pass: true, breaks: [] } }));
    expect(gate4(rows).verdict).toBe("incomplete");
    expect(gate4([...rows, ...rows.slice(0, 4)]).verdict).toBe("pass");
  });
});

describe("gate 6 arithmetic", () => {
  it("uses nearest-rank percentiles and the 3 s warm p95 target", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7], 95)).toBe(7);
    expect(perfVerdict([100, 200, 2999])).toMatchObject({ median: 200, p95: 2999, pass: true });
    expect(perfVerdict([100, 200, 3000]).pass).toBe(false);
    expect(perfVerdict([]).pass).toBe(false);
  });
});
