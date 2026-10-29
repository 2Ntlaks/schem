// Pattern templates (SPEC 9.4). The Appendix A worked examples are reached by the templates on
// their own, without the fixed placements and pre-routed trunks of tests/appendix-a.test.ts;
// each other template is checked on a small circuit of its own (tests/support/template-circuits.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type LayoutResult, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { TEMPLATES } from "../src/layout/templates/index.js";
import type { DrawnPin } from "../src/render/model.js";
import { BRIDGE, DIFF_PAIR, DIVIDER, HBRIDGE_BJT, I2C_DECOUPLED, I2C_RESET_RC, INVERTING, LED_GPIO, LED_SINK, LOW_SIDE, NONINVERTING, PULLS, TEMPLATE_CIRCUITS } from "./support/template-circuits.js";

const dir = join(import.meta.dirname, "..", "cases");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Project;
const pinAt = (r: LayoutResult, part: string, n: string): DrawnPin => r.render!.electrical.pins.find((p) => p.part === part && p.number === n)!;
const blocks = (r: LayoutResult) => Object.fromEntries(r.blocks!.map((b) => [b.parts.join(","), b.rank]));
const horizontalRuns = (r: LayoutResult) => r.render!.electrical.wires.filter((w) => w[0]![1] === w[w.length - 1]![1]);

describe("Appendix A.1 by the summing template (case 3)", () => {
  const p = load("case03-summing.json");
  const r = layout(p);
  const q = checkDrawing(p.circuit, r.pinDefs, r.render!);

  it("is valid and passes the verifier and the overlap checks", () => {
    expect(r.status).toBe("valid");
    expect(q.valid).toBe(true);
  });

  it("has the A.1 block graph: sources r0, region {U1, Rf, R1, R2, R3} r1, RL r2", () => {
    expect(blocks(r)).toEqual({ V1: 0, V2: 0, V3: 0, "U1,Rf,R1,R2,R3": 1, RL: 2 });
    expect(r.state!.templates).toContain("opamp-inverting@1:R1,R2,R3,Rf,U1,V1,V2,V3");
  });

  it("has 4 junction dots, no crossings, no convention break, no readability breach", () => {
    expect([q.metrics.dots, q.metrics.crossings]).toEqual([4, 0]);
    expect(q.conventions).toEqual([]);
    expect(q.breaches).toEqual([]);
  });

  it("draws the summing node as one column with three dots (R1, IN-, R2) and the output tap on the OUT row", () => {
    const inm = pinAt(r, "U1", "2"), out = pinAt(r, "U1", "1");
    const S = inm.at[0] - 3;
    const onNode = r.render!.electrical.dots.filter((d) => d[0] === S).map((d) => d[1]).sort((a, b) => a - b);
    expect(onNode).toEqual([pinAt(r, "R1", "2").at[1], inm.at[1], pinAt(r, "R2", "2").at[1]]);
    expect(r.render!.electrical.dots.filter((d) => d[0] !== S)).toEqual([[out.at[0] + 2, out.at[1]]]);
    // Inputs on their own rows, none on the IN- row; feedback resistor above the op-amp.
    expect(new Set(["R1", "R2", "R3"].map((id) => pinAt(r, id, "2").at[1])).size).toBe(3);
    expect(["R1", "R2", "R3"].map((id) => pinAt(r, id, "2").at[1])).not.toContain(inm.at[1]);
    expect(pinAt(r, "Rf", "1").at[1]).toBeLessThan(inm.at[1] - 2);
  });

  it("stands each source upright and turns its wire once into its input", () => {
    for (const [v, rin] of [["V1", "R1"], ["V2", "R2"], ["V3", "R3"]] as const) {
      const plus = pinAt(r, v, "+"), minus = pinAt(r, v, "-");
      expect(plus.at[0] === minus.at[0] && plus.at[1] < minus.at[1]).toBe(true);
      const row = pinAt(r, rin, "1").at[1];
      expect(r.render!.electrical.wires.some((w) => w.length === 2 && w.some((p) => p[0] === plus.at[0] && p[1] === row))).toBe(true);
    }
  });
});

describe("Appendix A.2 by the I2C template (case 5)", () => {
  const p = load("case05-i2c.json");
  const r = layout(p);
  const q = checkDrawing(p.circuit, r.pinDefs, r.render!);

  it("is valid and passes the verifier and the overlap checks", () => {
    expect(r.status).toBe("valid");
    expect(q.valid).toBe(true);
  });

  it("has the A.2 block graph: U1 r0, region {R1, R2} r1, peripherals after it (each its own column)", () => {
    expect(blocks(r)).toEqual({ U1: 0, "R1,R2": 1, U2: 2, U3: 3 });
    expect(r.blocks!.find((b) => b.parts.includes("R1"))!.links).toEqual(["U1", "U2", "U3"]);
  });

  it("has crossings = peripherals (2) and dots = 2 x peripherals (4), no convention break, no readability breach", () => {
    expect([q.metrics.crossings, q.metrics.dots]).toEqual([2, 4]);
    expect(q.conventions).toEqual([]);
    expect(q.breaches).toEqual([]);
  });

  it("draws the bus: SDA above SCL on the controller's right, one trunk each, peripherals in one row", () => {
    const sda = pinAt(r, "U1", "3"), scl = pinAt(r, "U1", "4");
    expect([sda.dir, scl.dir, scl.at[1] - sda.at[1]]).toEqual(["right", "right", 2]);
    for (const [pin, last] of [[sda, pinAt(r, "U3", "4")], [scl, pinAt(r, "U3", "3")]] as const) {
      expect(horizontalRuns(r).some((w) => w[0]![1] === pin.at[1] && Math.min(w[0]![0], w[1]![0]) === pin.at[0] && Math.max(w[0]![0], w[1]![0]) === last.at[0])).toBe(true);
    }
    for (const u of ["U2", "U3"]) {
      const [s, d] = [pinAt(r, u, "3"), pinAt(r, u, "4")];
      expect([s.dir, d.dir, s.at[0] < d.at[0], s.at[1] === pinAt(r, "U2", "3").at[1]]).toEqual(["up", "up", true, true]);
      // The supply pin is on top too, right of SDA, where the trunks end (room for decoupling).
      expect([pinAt(r, u, "1").dir, pinAt(r, u, "1").at[0] > d.at[0]]).toEqual(["up", true]);
    }
    // Pull-ups vertical, side by side, R1 left of R2, their ends above the SDA trunk.
    const [r1, r2] = [pinAt(r, "R1", "2"), pinAt(r, "R2", "2")];
    expect([r1.dir, r2.dir, r1.at[1] === r2.at[1], r1.at[0] < r2.at[0], r1.at[1] < sda.at[1]]).toEqual(["down", "down", true, true, true]);
  });
});

describe("the other templates", () => {
  const run = (p: Project) => { const r = layout(p); return { r, q: checkDrawing(p.circuit, r.pinDefs, r.render!) }; };

  it("op-amp inverting, one input: the input in line with IN-, no breaches", () => {
    const { r, q } = run(INVERTING);
    expect(blocks(r)).toEqual({ V1: 0, "U1,R2,R1": 1, RL: 2 });
    expect(pinAt(r, "R1", "2").at[1]).toBe(pinAt(r, "U1", "2").at[1]);
    expect([q.valid, q.metrics.crossings, q.conventions, q.breaches]).toEqual([true, 0, [], []]);
  });

  it("op-amp non-inverting: IN+ on top, feedback below, ground resistor vertical below the node", () => {
    const { r, q } = run(NONINVERTING);
    expect(blocks(r)).toEqual({ V1: 0, "U1,Rf,Rg": 1, RL: 2 });
    const inp = pinAt(r, "U1", "3"), inm = pinAt(r, "U1", "2");
    expect(inp.at[1]).toBeLessThan(inm.at[1]);
    expect(pinAt(r, "Rf", "1").at[1]).toBeGreaterThan(inm.at[1]);
    const g1 = pinAt(r, "Rg", "1"), g2 = pinAt(r, "Rg", "2");
    expect([g1.at[0] === g2.at[0], g1.at[1] < g2.at[1], g1.at[0] < inm.at[0]]).toEqual([true, true, true]);
    expect([q.valid, q.metrics.crossings, q.conventions, q.breaches]).toEqual([true, 0, [], []]);
  });

  it("voltage divider: one vertical column, the tap a T between the resistors", () => {
    const { r, q } = run(DIVIDER);
    expect(r.state!.templates).toEqual(["voltage-divider@1:R1,R2"]);
    const [a, b] = [pinAt(r, "R1", "2"), pinAt(r, "R2", "1")];
    expect([a.at[0] === b.at[0], a.dir, b.dir]).toEqual([true, "down", "up"]);
    expect(r.render!.electrical.dots).toEqual([[a.at[0], (a.at[1] + b.at[1]) / 2]]);
    expect([q.valid, q.metrics.crossings, q.conventions, q.breaches]).toEqual([true, 0, [], []]);
  });

  it("pull-up / pull-down: vertical, rail symbol on the far side", () => {
    const { r, q } = run(PULLS);
    expect(r.state!.templates).toEqual(["pull-down@1:R2", "pull-up@1:R1"]);
    expect([pinAt(r, "R1", "1").dir, pinAt(r, "R2", "2").dir]).toEqual(["up", "down"]);
    expect([q.valid, q.conventions]).toEqual([true, []]);
  });

  it("LED + series resistor to a ground symbol: one vertical line, resistor first", () => {
    const { r, q } = run(LED_GPIO);
    expect(r.state!.templates).toEqual(["led-series-vertical@1:D1,R1"]);
    const [rb, da] = [pinAt(r, "R1", "2"), pinAt(r, "D1", "A")];
    expect([rb.at[0] === da.at[0], rb.at[1] < da.at[1], pinAt(r, "R1", "1").at[1] < rb.at[1]]).toEqual([true, true, true]);
    expect([q.valid, q.metrics.crossings, q.breaches]).toEqual([true, 0, []]);
  });

  it("LED + series resistor otherwise: one horizontal line, resistor first", () => {
    const { r, q } = run(LED_SINK);
    expect(r.state!.templates).toEqual(["led-series@1:D1,R1"]);
    const [rb, da] = [pinAt(r, "R1", "2"), pinAt(r, "D1", "A")];
    expect([rb.at[1] === da.at[1], rb.at[0] < da.at[0]]).toEqual([true, true]);
    expect([q.valid, q.metrics.crossings, q.conventions, q.breaches]).toEqual([true, 0, [], []]);
  });

  it("bridge rectifier: two vertical diode legs side by side, AC in from the left at the midpoints, + on top", () => {
    const { r, q } = run(BRIDGE);
    expect(r.state!.templates).toContain("bridge-rectifier@1:D1,D2,D3,D4");
    const [d1k, d2k, d1a, d3k, d3a, d2a, d4k] = [pinAt(r, "D1", "K"), pinAt(r, "D2", "K"), pinAt(r, "D1", "A"), pinAt(r, "D3", "K"), pinAt(r, "D3", "A"), pinAt(r, "D2", "A"), pinAt(r, "D4", "K")];
    expect([d1a.at[0] === d3k.at[0], d2a.at[0] === d4k.at[0]]).toEqual([true, true]);
    expect([d1k.at[1] === d2k.at[1], d1k.at[0] < d2k.at[0], d1k.at[1] < d3a.at[1]]).toEqual([true, true, true]);
    expect(Math.max(pinAt(r, "V1", "1").at[0], pinAt(r, "V1", "2").at[0])).toBeLessThan(d1k.at[0]);
    expect([q.valid, q.conventions]).toEqual([true, []]);
  });

  it("H-bridge (BJT, without base-emitter resistors): high side above low side, load between the midpoints, drives outward", () => {
    const { r, q } = run(HBRIDGE_BJT);
    expect(r.state!.templates).toEqual(["h-bridge-pnp-npn@1:M1,Q1,Q2,Q3,Q4,R1,R2,R3,R4,U1"]);
    for (const [hi, lo] of [["Q1", "Q2"], ["Q3", "Q4"]] as const) {
      const [h, l] = [pinAt(r, hi, "C"), pinAt(r, lo, "C")];
      expect([h.at[0] === l.at[0], h.at[1] < l.at[1]], `${hi} above ${lo}`).toEqual([true, true]);
    }
    const [m1, m2] = [pinAt(r, "M1", "1"), pinAt(r, "M1", "2")];
    expect([m1.at[1] === m2.at[1], m1.at[0] > pinAt(r, "Q1", "C").at[0], m2.at[0] < pinAt(r, "Q3", "C").at[0]]).toEqual([true, true, true]);
    expect([pinAt(r, "R1", "2").at[0] < pinAt(r, "Q1", "B").at[0], pinAt(r, "R3", "2").at[0] > pinAt(r, "Q3", "B").at[0]]).toEqual([true, true]);
    expect([q.valid, q.conventions, q.breaches]).toEqual([true, [], []]);
  });

  it("low-side switch (without a pull-down): load above the transistor, base resistor in line on the left, flyback diode beside the load", () => {
    const { r, q } = run(LOW_SIDE);
    expect(r.state!.templates).toEqual(["low-side-npn-two-pin@1:D1,M1,Q1,R1"]);
    const [m2, qc, qb, rb] = [pinAt(r, "M1", "2"), pinAt(r, "Q1", "C"), pinAt(r, "Q1", "B"), pinAt(r, "R1", "2")];
    expect([m2.at[0] === qc.at[0], m2.at[1] < qc.at[1]]).toEqual([true, true]);
    expect([rb.at[1] === qb.at[1], rb.at[0] < qb.at[0]]).toEqual([true, true]);
    const [dk, m1] = [pinAt(r, "D1", "K"), pinAt(r, "M1", "1")];
    expect([dk.at[1] === m1.at[1], dk.at[0] < m1.at[0]]).toEqual([true, true]);
    expect([q.valid, q.metrics.crossings, q.conventions, q.breaches]).toEqual([true, 0, [], []]);
  });

  it("differential pair (MOSFET): mirror above the pair on two legs, mirror gates facing, inputs outward, tail centred", () => {
    const { r, q } = run(DIFF_PAIR);
    expect(r.state!.templates).toEqual(["diff-pair-nmos-pmos-mirror@1:Q1,Q2,Q3,Q4,RL,RT"]);
    const d = (id: string) => pinAt(r, id, "D");
    expect([d("Q1").at[0] === d("Q3").at[0], d("Q2").at[0] === d("Q4").at[0], d("Q2").at[0] - d("Q1").at[0]]).toEqual([true, true, 18]);
    expect([d("Q3").at[1] < d("Q1").at[1], d("Q3").at[1] === d("Q4").at[1], d("Q1").at[1] === d("Q2").at[1]]).toEqual([true, true, true]);
    expect(["Q3", "Q4", "Q1", "Q2"].map((id) => pinAt(r, id, "G").dir)).toEqual(["right", "left", "left", "right"]);
    const [rt, s1, s2] = [pinAt(r, "RT", "1"), pinAt(r, "Q1", "S"), pinAt(r, "Q2", "S")];
    expect([rt.at[0] * 2 === s1.at[0] + s2.at[0], rt.at[1] > s1.at[1]]).toEqual([true, true]);
    expect(pinAt(r, "RL", "1").at[0]).toBeGreaterThan(pinAt(r, "Q2", "G").at[0]);
    expect([q.valid, q.conventions]).toEqual([true, []]);
  });

  it("I2C with a decoupled peripheral: the peripheral sits just under the bus, its capacitors rise beside it", () => {
    const { r, q } = run(I2C_DECOUPLED);
    expect(r.state!.templates).toEqual(["i2c-pullups@2:R1,R2,U1,U2"]);
    const scl = pinAt(r, "U1", "4").at[1];
    expect(pinAt(r, "U2", "6").at[1] - scl).toBeLessThanOrEqual(3);
    expect(pinAt(r, "C1", "1").at[1]).toBeLessThan(scl);
    expect(q.valid).toBe(true);
  });

  it("I2C bus corridor: a reset RC in a column the bus crosses sits above the bus, so both trunks run straight", () => {
    const { r, q } = run(I2C_RESET_RC);
    expect(r.notes.filter((n) => n.includes("blocked"))).toEqual([]);
    const sda = pinAt(r, "U1", "3").at[1];
    expect(pinAt(r, "C1", "2").at[1]).toBeLessThan(sda);
    expect(horizontalRuns(r).some((w) => w[0]![1] === sda && Math.abs(w[w.length - 1]![0] - w[0]![0]) > 20)).toBe(true);
    expect([q.valid, q.metrics.crossings]).toEqual([true, 1]);
  });

  it("a battery loop (case 1) matches no template: a series loop is drawn as a loop", () => {
    expect(layout(load("case01-led.json")).state!.templates).toBeUndefined();
  });
});

describe("template mechanics", () => {
  it("every template is switched on: no stubs remain (decoupling is src/layout/decoupling.ts, not a template)", () => {
    expect(TEMPLATES.filter((t) => t.status === "stub").map((t) => t.id)).toEqual([]);
  });

  it("priorities: the I2C template takes the bus pull-ups before the pull-up template", () => {
    expect(layout(load("case05-i2c.json")).state!.templates).toEqual(["i2c-pullups@2:R1,R2,U1,U2,U3"]);
  });

  it("templates can be switched off (the fallback), giving the Phase 0a layout", () => {
    const r = layout(load("case03-summing.json"), { templates: false });
    expect(r.status).toBe("valid");
    expect(r.state!.templates).toBeUndefined();
    expect(r.blocks!.every((b) => b.parts.length === 1)).toBe(true);
  });

  it("are deterministic, and declaration order does not change the drawing (SPEC 9.6)", () => {
    for (const [name, p] of Object.entries(TEMPLATE_CIRCUITS)) {
      const a = toSvg(layout(p).render!);
      expect(toSvg(layout(p).render!), name).toBe(a);
      const reversed: Project = { ...p, circuit: { ...p.circuit, parts: [...p.circuit.parts].reverse(), nets: [...p.circuit.nets].reverse().map((n) => ({ ...n, endpoints: [...n.endpoints].reverse() })) } };
      expect(toSvg(layout(reversed).render!), `${name} reversed`).toBe(a);
    }
  });
});
