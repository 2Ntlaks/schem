// The general layout (no template): flow inference (src/layout/flow.ts), vertical stacks
// (src/layout/stacks.ts) and the supply-symbol rule (src/layout/ports.ts), on the bench circuits
// in bench/circuits/. These pin down what each drawing must show, not exact coordinates.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type LayoutResult } from "../src/layout/layout.js";
import { drawnAsPorts } from "../src/layout/ports.js";
import { netKind, railLevel } from "../src/core/model.js";
import { checkDrawing } from "../src/quality/index.js";
import { readProject } from "../src/io/project.js";
import type { DrawnPin } from "../src/render/model.js";
import { scoreDrawing } from "../scripts/lib/bench-score.js";

const DIR = join(import.meta.dirname, "..", "bench", "circuits");
const names = readdirSync(DIR).filter((f) => f.endsWith(".schem.json")).map((f) => f.replace(".schem.json", "")).sort();
const runs = new Map<string, { r: LayoutResult; score: number; valid: boolean }>();
const run = (name: string) => {
  if (!runs.has(name)) {
    const p = readProject(join(DIR, `${name}.schem.json`)).project!;
    const r = layout(p);
    const q = checkDrawing(p.circuit, r.pinDefs, r.render!);
    runs.set(name, { r, valid: q.valid, score: scoreDrawing(p.circuit, r.pinDefs, r.render!, q).total });
  }
  return runs.get(name)!;
};
const pin = (name: string, part: string, n: string): DrawnPin => run(name).r.render!.electrical.pins.find((p) => p.part === part && p.number === n)!;
const x = (name: string, part: string) => run(name).r.state!.parts[part]!.at[0];

describe("bench circuits", () => {
  for (const name of names) it(`${name} draws valid`, () => {
    expect([run(name).r.status, run(name).valid]).toEqual(["valid", true]);
  });

  it("the total score stays within 5% of bench/baseline.json", () => {
    const baseline = JSON.parse(readFileSync(join(DIR, "..", "baseline.json"), "utf8")).scores as Record<string, number>;
    const total = names.reduce((s, n) => s + run(n).score, 0), was = names.reduce((s, n) => s + baseline[n]!, 0);
    expect(total).toBeLessThanOrEqual(was * 1.05);
  });
});

describe("vertical stacks", () => {
  it("common-emitter amplifier: the collector resistor stands above the collector, the emitter resistor below the emitter", () => {
    const [c, e] = [pin("ce-amp", "Q1", "C"), pin("ce-amp", "Q1", "E")];
    const [r3, r4] = [pin("ce-amp", "R3", "2"), pin("ce-amp", "R4", "1")];
    expect([r3.at[0] === c.at[0], r3.at[1] < c.at[1]]).toEqual([true, true]);
    expect([r4.at[0] === e.at[0], r4.at[1] > e.at[1]]).toEqual([true, true]);
    expect(pin("ce-amp", "Q1", "B").dir).toBe("left");
  });

  it("common-emitter amplifier: the bypass capacitor stands beside the emitter resistor, at the same height", () => {
    const [r4, c2] = [pin("ce-amp", "R4", "1"), pin("ce-amp", "C2", "1")];
    expect([c2.at[1] === r4.at[1], c2.at[0] > r4.at[0]]).toEqual([true, true]);
  });

  it("555 timer: the timing string R1, R2, C1 is one column from the supply down to ground", () => {
    const ys = ["R1", "R2", "C1"].map((id) => run("ne555").r.state!.parts[id]!.at[1]);
    const xs = ["R1", "R2", "C1"].map((id) => pin("ne555", id, id === "C1" ? "1" : "1").at[0]);
    expect(new Set(xs).size).toBe(1);
    expect(ys[0]! < ys[1]! && ys[1]! < ys[2]!).toBe(true);
  });

  it("multivibrator: each LED and its resistor stand above their transistor's collector", () => {
    for (const [q, r, d] of [["Q1", "R1", "D1"], ["Q2", "R4", "D2"]] as const) {
      const c = pin("multivibrator", q, "C");
      expect([pin("multivibrator", r, "2").at[0], pin("multivibrator", d, "K").at[0]]).toEqual([c.at[0], c.at[0]]);
      expect(pin("multivibrator", d, "A").at[1]).toBeLessThan(pin("multivibrator", r, "1").at[1]);
    }
  });

  it("stacks can be switched off (the fallback), and the drawing is still valid", () => {
    const p = readProject(join(DIR, "ce-amp.schem.json")).project!;
    const r = layout(p, { stacks: false });
    expect(r.status).toBe("valid");
    expect(r.notes.some((n) => n.startsWith("stack:"))).toBe(false);
  });
});

describe("flow inference", () => {
  it("comparator with no source: the reference divider is left of the op-amp, the MOSFET and motor right of it", () => {
    expect(pin("schmitt", "U1", "1").dir).toBe("right");
    expect(x("schmitt", "R4")).toBeLessThan(x("schmitt", "U1"));
    expect(x("schmitt", "Q1")).toBeGreaterThan(x("schmitt", "U1"));
    expect(pin("schmitt", "Q1", "G").dir).toBe("left");
  });

  it("regulator: input connector, regulator, output connector, left to right, though the rails are symbols", () => {
    expect(x("regulator", "J1")).toBeLessThan(x("regulator", "U1"));
    expect(x("regulator", "U1")).toBeLessThan(x("regulator", "J2"));
    expect(x("regulator", "U1")).toBeLessThan(x("regulator", "C3"));
  });

  it("microcontroller board: buttons on the input side, LEDs on the output side", () => {
    expect(x("mcu", "SW1")).toBeLessThan(x("mcu", "U1"));
    expect(x("mcu", "SW2")).toBeLessThan(x("mcu", "U1"));
    expect(x("mcu", "D1")).toBeGreaterThan(x("mcu", "U1"));
  });

  it("shift register: the controller is left of the chip it drives", () => {
    expect(x("shift", "U1")).toBeLessThan(x("shift", "U2"));
  });

  it("no op-amp or transistor in the bench faces backwards, except the PNP in the push-pull pair", () => {
    const backwards: string[] = [];
    for (const name of names) for (const p of run(name).r.render!.electrical.pins) {
      const type = readProject(join(DIR, `${name}.schem.json`)).project!.circuit.parts.find((q) => q.id === p.part)!.type;
      if (((type === "opamp" && p.number === "2") || (["npn", "pnp", "nmos", "pmos"].includes(type) && (p.number === "B" || p.number === "G"))) && p.dir === "right") backwards.push(`${name}:${p.part}`);
    }
    expect(backwards.filter((b) => b !== "pushpull:Q2")).toEqual([]);
  });
});

describe("supply symbols (src/layout/ports.ts)", () => {
  it("recognizes negative rails and respects explicit net kinds", () => {
    for (const name of ["VEE", "vee", "V-", "-12V", "-2.5V", "-3V3"]) {
      expect(netKind({ name })).toBe("power");
      expect(railLevel({ name })).toBe(-1);
      expect(railLevel({ name, kind: "signal" })).toBeUndefined();
      expect(railLevel({ name, kind: "ground" })).toBe(0);
    }
    expect(netKind({ name: "-CLK" })).toBe("signal");
    expect(railLevel({ name: "-BIAS", kind: "power" })).toBe(-1);
    expect(railLevel({ name: "VSS" })).toBe(0);
    expect(railLevel({ name: "VSS", kind: "power" })).toBe(-1);
  });

  it("puts the push-pull output between the emitters and draws the negative supply below its pins", () => {
    const m = run("pushpull").r.render!;
    const q1 = pin("pushpull", "Q1", "E"), q2 = pin("pushpull", "Q2", "E");
    expect([q1.at[0], q1.dir, q2.dir]).toEqual([q2.at[0], "down", "up"]);
    expect(q1.at[1]).toBeLessThan(q2.at[1]);
    for (const [part, number] of [["Q2", "C"], ["R5", "2"]] as const) {
      const p = pin("pushpull", part, number);
      expect(p.dir).toBe("down");
      expect(m.electrical.ports).toContainEqual({ at: p.at, text: "VEE", kind: "power", domain: null });
      const label = m.art.find((a) => a.t === "text" && a.owner === `port:${part}[${number}]`);
      expect(label).toMatchObject({ t: "text", text: "VEE", baseline: "top" });
      expect(label?.t === "text" && label.y > p.at[1]).toBe(true);
    }
  });

  const type = (t: Record<string, string>) => (p: string) => t[p];
  it("a two-pin supply net between a battery and one part is a wire", () => {
    expect(drawnAsPorts({ id: "n", name: "VCC", endpoints: [] }, ["B1[+]", "R1[1]"], type({ B1: "battery", R1: "resistor" }))).toBe(false);
  });
  it("a two-pin supply net with no source on it is drawn with symbols", () => {
    expect(drawnAsPorts({ id: "n", name: "VCC", endpoints: [] }, ["R1[1]", "R3[1]"], type({ R1: "resistor", R3: "resistor" }))).toBe(true);
  });
  it("one endpoint, or three and more, are symbols; a signal net or an unnamed net never is", () => {
    expect(drawnAsPorts({ id: "n", name: "GND", endpoints: [] }, ["R1[2]"], type({}))).toBe(true);
    expect(drawnAsPorts({ id: "n", name: "GND", endpoints: [] }, ["B1[-]", "R1[2]", "D1[K]"], type({ B1: "battery" }))).toBe(true);
    expect(drawnAsPorts({ id: "n", name: "OUT", endpoints: [] }, ["R1[2]", "R2[1]", "U1[1]"], type({}))).toBe(false);
    expect(drawnAsPorts({ id: "n", kind: "power", endpoints: [] }, ["R1[2]", "R2[1]", "U1[1]"], type({}))).toBe(false);
  });
});
