import { describe, expect, it } from "vitest";
import { phase0Gates, type CaseEvidence, type EditEvidence } from "../scripts/lib/phase0-gates.js";

const cases = (n: number): CaseEvidence[] => Array.from({ length: n }, (_, i) => ({ case: `case${String(i + 1).padStart(2, "0")}-example`, status: "valid", verifier: "valid", overlaps: 0 }));
const edits = (full = false): EditEvidence[] => ["03", "05", "07", ...(full ? ["11"] : [])].flatMap((n) => ["longer-value", "add-part", "remove-part", "pin-sides"].map((kind) => ({ script: `case${n}-${kind}`, status: "saved", asExpected: true, layout: "valid", gate4: { pass: true, breaks: [] }, issues: [] })));

describe("Phase 0b gate evidence", () => {
  it("keeps a successful validation subset and unrated gates incomplete", () => {
    const g = phase0Gates(cases(8), edits(), false);
    expect(g.every((x) => x.status === "incomplete")).toBe(true);
    expect(g[0]).toMatchObject({ evaluated: 8, required: 12, failures: [] });
    expect(g[3]).toMatchObject({ evaluated: 12, required: 16, failures: [] });
  });

  it("accepts low confidence only on case 8", () => {
    const c = cases(8);
    c[7]!.status = "valid_low_confidence";
    expect(phase0Gates(c, edits(), false)[0]!.failures).toEqual([]);
    c[3]!.status = "valid_low_confidence";
    expect(phase0Gates(c, edits(), false)[0]!.status).toBe("fail");
  });

  it.each(["budget_exhausted", "invalid_input", "missing symbol: resistor"])("fails missing/invalid drawings: %s", (status) => {
    const c = cases(8); c[0]!.status = status;
    expect(phase0Gates(c, edits(), false)[0]!.status).toBe("fail");
  });

  it("requires verifier and overlap evidence and exactly one result per expected case", () => {
    for (const bad of [{ overlaps: 1 }, { verifier: "INVALID" }, { overlaps: undefined }, { verifier: undefined }]) {
      const c = cases(8); Object.assign(c[0]!, bad);
      expect(phase0Gates(c, edits(), false)[0]!.status).toBe("fail");
    }
    expect(phase0Gates(cases(7), edits(), false)[0]!.status).toBe("fail");
    expect(phase0Gates([...cases(8), cases(1)[0]!], edits(), false)[0]!.status).toBe("fail");
  });

  it("fails expectation mismatches, unstable edits and missing edit results", () => {
    for (const bad of [{ asExpected: false }, { gate4: { pass: false, breaks: ["locked part moved"] } }, { gate4: undefined }, { layout: "budget_exhausted" }]) {
      const e = edits(); Object.assign(e[0]!, bad);
      expect(phase0Gates(cases(8), e, false)[3]!.status).toBe("fail");
    }
    expect(phase0Gates(cases(8), edits().slice(1), false)[3]!.status).toBe("fail");
  });

  it("allows only the specified fixed-symbol rejection with E270", () => {
    const e = edits();
    Object.assign(e[3]!, { status: "rejected (invalid_input)", layout: undefined, gate4: undefined, issues: ["E270 fixed symbol"] });
    expect(phase0Gates(cases(8), e, false)[3]!.failures).toEqual([]);
    e[3]!.issues = ["E102 invalid script"];
    expect(phase0Gates(cases(8), e, false)[3]!.status).toBe("fail");
  });

  it("passes only measured full-set gates when every required result succeeds", () => {
    const g = phase0Gates(cases(12), edits(true), true);
    expect(g.map((x) => x.status)).toEqual(["pass", "incomplete", "incomplete", "pass", "incomplete", "incomplete"]);
  });
});
