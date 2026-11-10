// Edit operations and incremental mode (SPEC 11.3, 9.5), and the layer 5 edit-stability tests
// (SPEC 13 item 6, SPEC 15 gate 4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type Project } from "../src/layout/layout.js";
import { edit, revision, type EditOp } from "../src/edit/edit.js";
import { changeReport, stabilityBreaks } from "../src/edit/report.js";
import type { LayoutState } from "../src/core/intent.js";
import { circuitEquals } from "../src/core/equals.js";
import { pinDefsOf } from "../src/layout/layout.js";
import { EDIT_SCRIPTS } from "./support/edit-scripts.js";
import { generate } from "./support/generate.js";
import { randomEdit } from "./support/random-edits.js";

const dir = join(import.meta.dirname, "..", "cases");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Project;
const start = (f: string) => { const project = load(f); return { project, previous: layout(project).state! }; };

describe("edit scripts on the development cases (gate 4)", () => {
  for (const [f, scripts] of Object.entries(EDIT_SCRIPTS)) for (const [name, ops] of Object.entries(scripts)) {
    it(`${f}: ${name} is saved, valid and stable`, () => {
      const r = edit({ ...start(f), ops });
      expect(r.issues.filter((i) => i.startsWith("edit rejected"))).toEqual([]);
      expect(r.saved).toBe(true);
      expect(r.check!.valid).toBe(true);
      expect(r.mode).toBe("incremental");
      expect(stabilityBreaks(r.report!)).toEqual([]);
    });
  }
});

describe("visual operations", () => {
  it("are setters: the same operation twice gives the same project", () => {
    const s = start("case05-i2c.json");
    const ops: EditOp[] = [{ op: "setOrientation", part: "R1", rot: 90, flip: true }, { op: "align", axis: "row", parts: ["U2", "U3"] }];
    const once = edit({ ...s, ops });
    const twice = edit({ project: once.project, previous: once.layout!.state!, ops });
    expect(once.saved && twice.saved).toBe(true);
    expect(twice.revision).toBe(once.revision);
    expect(twice.project.intent!.hints!.length).toBe(2);
  });

  it("never change the circuit", () => {
    const s = start("case03-summing.json");
    const r = edit({ ...s, ops: [{ op: "setLabelSide", part: "R1", side: "below" }, { op: "place", part: "RL", rel: "right-of", of: "U1" }, { op: "setSpacing", factor: 1.5 }] });
    expect(r.saved).toBe(true);
    expect(circuitEquals(s.project.circuit, pinDefsOf(s.project.circuit), r.project.circuit)).toBe(true);
  });

  it("a locked part does not move when others are edited", () => {
    const s = start("case03-summing.json");
    const locked = edit({ ...s, ops: [{ op: "lock", part: "U1" }] });
    const at = locked.layout!.state!.parts.U1!.at;
    const r = edit({ project: locked.project, previous: locked.layout!.state!, ops: [{ op: "removePart", part: "R3" }, { op: "setProp", part: "R1", key: "value", value: "22k" }] });
    expect(r.saved).toBe(true);
    expect(r.layout!.state!.parts.U1!.at).toEqual(at);
    expect(r.report!.lockedMoved).toEqual([]);
  });

  it("a flipped pull-up is drawn correctly (its pin faces away from the supply symbol)", () => {
    const r = edit({ ...start("case05-i2c.json"), ops: [{ op: "setOrientation", part: "R1", rot: 90, flip: true }] });
    expect(r.saved).toBe(true);
    expect(r.check!.valid).toBe(true);
  });

  it("a pin-side change moves the pins", () => {
    const s = start("case05-i2c.json");
    const r = edit({ ...s, ops: [{ op: "setPinSides", part: "U2", left: ["U2.SDA", "U2.SCL"] }] });
    expect(r.layout!.state!.parts.U2!.sides!.left).toEqual(["4", "3"]);
  });
});

describe("transactions (D4)", () => {
  it("an invalid operation leaves the project unchanged", () => {
    const s = start("case01-led.json");
    const r = edit({ ...s, ops: [{ op: "setProp", part: "R1", key: "value", value: "1k" }, { op: "connect", endpoints: ["R1.1", "XX9.1"] }] });
    expect(r.saved).toBe(false);
    expect(r.status).toBe("invalid_input");
    expect(r.project).toBe(s.project);
    expect(r.revision).toBe(revision(s.project));
  });

  it("adding a part that exists fails clearly (retry safety)", () => {
    const s = start("case01-led.json");
    const r = edit({ ...s, ops: [{ op: "addPart", part: { id: "R1", type: "resistor" } }] });
    expect(r.saved).toBe(false);
    expect(r.issues.join(" ")).toMatch(/E250 part "R1" already exists/);
  });

  it("a stale revision or layout token is a conflict", () => {
    const s = start("case01-led.json");
    expect(edit({ ...s, ops: [], expectedRevision: "0".repeat(64) }).status).toBe("conflict");
    expect(edit({ ...s, ops: [], expectedLayout: "0".repeat(64) }).status).toBe("conflict");
    const ok = edit({ ...s, ops: [{ op: "setLabelSide", part: "R1", side: "below" }], expectedRevision: revision(s.project) });
    expect(ok.saved).toBe(true);
  });

  it("locks that contradict a strict hint are rejected with the conflicting set", () => {
    const s = start("case01-led.json");
    const r = edit({ ...s, ops: [
      { op: "lock", part: "B1", at: [10, 10] }, { op: "lock", part: "D1", at: [40, 10] },
      { op: "place", part: "B1", rel: "right-of", of: "D1", priority: "strict" },
    ] });
    expect(r.saved).toBe(false);
    expect(r.status).toBe("infeasible");
    expect(r.issues.join(" ")).toMatch(/lock B1.*hint h1|hint h1.*lock B1/);
  });

  it("removing a part drops the hints and locks that named it", () => {
    const s = start("case03-summing.json");
    const a = edit({ ...s, ops: [{ op: "lock", part: "RL" }, { op: "align", axis: "row", parts: ["R1", "RL"] }] });
    const b = edit({ project: a.project, previous: a.layout!.state!, ops: [{ op: "removePart", part: "RL" }] });
    expect(b.saved).toBe(true);
    expect(b.project.intent!.locks).toEqual([]);
    expect(b.project.intent!.hints).toEqual([]);
  });
});

describe("generated circuits under random edits (layer 5)", () => {
  it("every saved edit passes layers 1-2, and at least 95% meet the stability gate", () => {
    let saved = 0, stable = 0;
    const unstable: string[] = [];
    for (let seed = 1; seed <= 150; seed++) {
      const g = generate(seed, 5);
      const base = layout({ circuit: g.circuit });
      if (!base.state || !base.status.startsWith("valid")) continue;
      const e = randomEdit(g.circuit, seed * 31);
      if (!e.ops.length) continue;
      const r = edit({ project: { circuit: g.circuit }, previous: base.state, ops: e.ops });
      if (!r.saved) continue;
      saved++;
      expect(r.check!.valid, `#${seed}`).toBe(true);
      const breaks = stabilityBreaks(r.report!);
      if (breaks.length) unstable.push(`#${seed} ${e.kind}: ${breaks.join("; ")}`); else stable++;
    }
    expect(saved).toBeGreaterThan(120);
    expect(stable / saved, unstable.join("\n")).toBeGreaterThanOrEqual(0.95);
  }, 300_000);
});

describe("strict edits", () => {
  // Generated circuit 50 with its random edit: its best layout reroutes two nets the edit did not involve.
  const g = generate(50, 5);
  const previous = layout({ circuit: g.circuit }).state!;
  const { ops } = randomEdit(g.circuit, 50 * 31);

  it("an edit past the stability gate is saved by default and refused when strict", () => {
    const loose = edit({ project: { circuit: g.circuit }, previous, ops });
    expect(loose.saved).toBe(true);
    expect(stabilityBreaks(loose.report!)).toEqual(["routes changed on 2 nets the edit did not involve (at most 1): n5, n6"]);

    const strict = edit({ project: { circuit: g.circuit }, previous, ops, strict: true });
    expect(strict.saved).toBe(false);
    expect(strict.status).toBe("unstable");
    expect(strict.project.circuit).toBe(g.circuit);
    expect(stabilityBreaks(strict.report!)).toEqual(["routes changed on 2 nets the edit did not involve (at most 1): n5, n6"]);
  });

  it("strict still saves an edit that asks for the whole sheet to be redrawn", () => {
    const r = edit({ project: { circuit: g.circuit }, previous, ops: [...ops, { op: "relayout", mode: "canonical" }], strict: true });
    expect(r.saved).toBe(true);
    expect(r.mode).toBe("canonical");
  });

  it("strict saves the stable development edits unchanged", () => {
    for (const [f, scripts] of Object.entries(EDIT_SCRIPTS)) for (const ops of Object.values(scripts)) {
      const s = start(f);
      expect(JSON.stringify(edit({ ...s, ops, strict: true }).layout!.state)).toBe(JSON.stringify(edit({ ...s, ops }).layout!.state));
    }
  });
});

describe("stability report (SPEC 15 gate 4)", () => {
  it("does not round a mean displacement just over the limit down to the limit", () => {
    const before: LayoutState = { parts: {}, routes: {} };
    const after: LayoutState = { parts: {}, routes: {} };
    for (let i = 0; i < 100; i++) {
      const id = `R${i}`;
      before.parts[id] = { at: [i * 10, 0], orient: { rot: 0, flip: false } };
      after.parts[id] = { at: [i * 10 + (i < 50 ? 0 : 4), i === 99 ? 1 : 0], orient: { rot: 0, flip: false } };
    }
    const report = changeReport(before, after, new Set(), new Set(), new Set());
    expect(report.untouched.meanMove).toBeGreaterThan(2);
    expect(stabilityBreaks(report)).toHaveLength(1);
  });

  it("allows one unrelated reroute and rejects two", () => {
    const before: LayoutState = {
      parts: {},
      routes: { n1: { terminals: "A", runs: [[[0, 0], [2, 0]]] }, n2: { terminals: "B", runs: [[[0, 3], [2, 3]]] } },
    };
    const after = structuredClone(before);
    after.routes.n1!.runs = [[[0, 1], [2, 1]]];
    expect(stabilityBreaks(changeReport(before, after, new Set(), new Set(), new Set()))).toEqual([]);
    after.routes.n2!.runs = [[[0, 4], [2, 4]]];
    expect(stabilityBreaks(changeReport(before, after, new Set(), new Set(), new Set())))
      .toEqual(["routes changed on 2 nets the edit did not involve (at most 1): n1, n2"]);
    expect(stabilityBreaks(changeReport(before, after, new Set(), new Set(["n1"]), new Set()))).toEqual([]);
  });
});
