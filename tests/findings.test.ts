// Findings harness (SPEC 10.2): every offered fix is checked, so applying it must do what it
// says; fixes are tied to the layout they were checked on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type Project } from "../src/layout/layout.js";
import { edit } from "../src/edit/edit.js";
import { review } from "../src/edit/findings.js";

const dir = join(import.meta.dirname, "..", "cases");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Project;

const counts = (r: ReturnType<typeof edit>) => {
  const q = r.check!;
  return { invalid: q.valid ? 0 : 1, conventions: q.conventions.length, breaches: q.breaches.length, crossings: q.metrics.crossings, bends: q.metrics.bends, wireLength: q.metrics.wireLength };
};

// A resistor across the supply forced sideways: a convention break with an obvious fix.
const sideways: Project = {
  circuit: {
    parts: [
      { id: "B1", type: "battery", props: { value: "9V" } },
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "R2", type: "resistor", props: { value: "1k" } },
      { id: "D1", type: "led" },
    ],
    nets: [
      { id: "n1", name: "VCC", endpoints: ["B1.+", "R1.1", "R2.1"] },
      { id: "n2", endpoints: ["R2.2", "D1.anode"] },
      { id: "n3", name: "GND", endpoints: ["B1.-", "R1.2", "D1.cathode"] },
    ],
  },
  intent: { hints: [{ id: "h1", type: "orient", part: "R1", rot: 0, flip: false, priority: "normal" }] },
};

describe("checked fixes", () => {
  for (const project of [load("case01-led.json"), load("case03-summing.json"), load("case05-i2c.json"), sideways]) {
    const name = project.meta?.title ?? "sideways resistor";
    it(`${name}: every offered fix, applied, removes its finding and changes what it says it changes`, () => {
      const base = layout(project);
      const before = edit({ project, previous: base.state!, ops: [] });
      for (const f of review(project, base.state!, base.render!)) {
        if (!f.fix) { expect(f.message).toMatch(/No checked fix found|no fix searched/); continue; }
        expect(f.fix.changesCircuit).toBe(false);
        const r = edit({ project, previous: base.state!, ops: f.fix.ops, expectedLayout: f.fix.expectedLayout });
        expect(r.saved, f.id).toBe(true);
        const again = review(r.project, r.layout!.state!, r.layout!.render!).map((g) => g.id);
        expect(again, f.id).not.toContain(f.id);
        const delta: Record<string, number> = {};
        const [a, b] = [counts(before), counts(r)];
        for (const k of Object.keys(a) as Array<keyof typeof a>) if (a[k] !== b[k]) delta[k] = b[k] - a[k];
        expect(delta, f.id).toEqual(f.fix.expect);
      }
    });
  }

  it("finds the obvious fix for a sideways resistor across the supply", () => {
    const base = layout(sideways);
    const f = review(sideways, base.state!, base.render!).find((x) => x.id === "C10-R1")!;
    expect(f.fix!.ops).toEqual([{ op: "setOrientation", part: "R1", rot: 90 }]);
    expect(f.fix!.tradeoff).toBeNull();
  });

  it("finds a fix for the two dots one step apart in case 3", () => {
    const p = load("case03-summing.json");
    const base = layout(p);
    expect(review(p, base.state!, base.render!).find((x) => x.id === "L-minDotSpacing")!.fix).not.toBeNull();
  });

  it("a fix checked on one layout is refused on another (expectedLayout)", () => {
    const base = layout(sideways);
    const f = review(sideways, base.state!, base.render!).find((x) => x.id === "C10-R1")!;
    const moved = edit({ project: sideways, previous: base.state!, ops: [{ op: "setLabelSide", part: "R2", side: "below" }] });
    const r = edit({ project: moved.project, previous: moved.layout!.state!, ops: f.fix!.ops, expectedLayout: f.fix!.expectedLayout });
    expect(r.status).toBe("conflict");
  });
});
