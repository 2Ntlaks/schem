// General layout polish tests: top supply-pin ordering (power_in left of power_out),
// astable multivibrator crossing reduction, and incremental edit stability.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Circuit } from "../src/core/model.js";
import { edit } from "../src/edit/edit.js";
import { stabilityBreaks } from "../src/edit/report.js";
import { readProject } from "../src/io/project.js";
import { layout, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { verify } from "../src/verify/verify.js";
import { generate } from "./support/generate.js";
import { randomEdit } from "./support/random-edits.js";

function draw(circuit: Circuit) {
  const project: Project = { meta: { title: "layout-polish" }, circuit };
  const r = layout(project);
  expect(r.status, [...r.issues, ...r.notes].join(" | ")).toBe("valid");
  const el = r.render!.electrical;
  expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
  expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
  const pin = (part: string, n: string) => el.pins.find((p) => p.part === part && p.number === n)!;
  return { r, pin };
}

describe("top supply-pin ordering", () => {
  it("places power_in left of power_out on top even when the output rail name sorts earlier alphabetically", () => {
    const circuit: Circuit = {
      parts: [
        {
          id: "U1",
          type: "ic",
          props: { label: "Regulator" },
          pins: [
            { number: "1", name: "VIN", role: "power_in" },
            { number: "2", name: "GND", role: "ground" },
            { number: "3", name: "VOUT", role: "power_out" },
          ],
        },
        { id: "R1", type: "resistor", props: { value: "1k" } },
        { id: "D1", type: "led" },
        { id: "R2", type: "resistor", props: { value: "10k" } },
        { id: "D2", type: "led" },
        { id: "B1", type: "battery", props: { value: "9V" } },
      ],
      nets: [
        { id: "n1", name: "VBAT", endpoints: ["B1[+]", "U1[1]", "R2[1]"] },
        { id: "n2", name: "5V", endpoints: ["U1[3]", "R1[1]"] },
        { id: "n3", endpoints: ["R1[2]", "D1[A]"] },
        { id: "n5", endpoints: ["R2[2]", "D2[A]"] },
        { id: "n4", name: "GND", endpoints: ["B1[-]", "U1[2]", "D1[K]", "D2[K]"] },
      ],
    };
    const { pin } = draw(circuit);
    expect(pin("U1", "1").dir).toBe("up");
    expect(pin("U1", "3").dir).toBe("up");
    expect(pin("U1", "1").at[0]).toBeLessThan(pin("U1", "3").at[0]);
  });
});

describe("astable multivibrator crossing reduction", () => {
  it("draws the cross-coupled astable with a single centre crossing, level capacitors, and no readability breaches", () => {
    const project = readProject(join(import.meta.dirname, "../bench/circuits/multivibrator.schem.json")).project!;
    const r = layout(project);
    expect(r.status).toBe("valid");
    const q = checkDrawing(project.circuit, r.pinDefs, r.render!);
    expect(q.valid).toBe(true);
    expect(q.breaches).toEqual([]);
    expect(q.conventions).toEqual([]);
    expect(q.metrics.crossings).toBe(1);
    const pins = r.render!.electrical.pins;
    const c1 = pins.find((p) => p.part === "C1" && p.number === "1")!;
    const c2 = pins.find((p) => p.part === "C2" && p.number === "1")!;
    expect(c1.at[1]).toBe(c2.at[1]);
  });

  it("stays valid under long bias resistor values without interior contradiction", () => {
    const project = readProject(join(import.meta.dirname, "../bench/circuits/multivibrator.schem.json")).project!;
    for (const id of ["R2", "R3"]) {
      const part = project.circuit.parts.find((p) => p.id === id)!;
      part.props = { ...part.props, value: "470k 1% MF" };
    }
    const r = layout(project);
    expect(r.status).toBe("valid");
    expect(r.state!.templates?.some((k) => k.startsWith("npn-led-astable@"))).toBe(true);
    const q = checkDrawing(project.circuit, r.pinDefs, r.render!);
    expect(q.valid).toBe(true);
    expect(q.metrics.crossings).toBe(1);
  });
});

describe("incremental edit stability", () => {
  it("keeps untouched columns in place on add-part edits whose existing outlines still clear", () => {
    for (const seed of [80, 89, 143]) {
      const g = generate(seed, 5);
      const base = layout({ circuit: g.circuit });
      expect(base.status.startsWith("valid"), `seed ${seed}`).toBe(true);
      const e = randomEdit(g.circuit, seed * 31);
      const r = edit({ project: { circuit: g.circuit }, previous: base.state, ops: e.ops });
      expect(r.saved, `seed ${seed}`).toBe(true);
      expect(stabilityBreaks(r.report!), `seed ${seed}`).toEqual([]);
    }
  });
});
