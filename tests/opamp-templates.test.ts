// Templates for active filters and oscillators around one op-amp: Sallen-Key filters, the
// integrator, the inverting low-pass, the relaxation oscillator and the Wien bridge. Each one is
// checked on a small circuit of its own (tests/support/template-circuits.ts): it matches, the
// drawing is valid with no crossing, convention break or readability breach, and the parts sit
// where a textbook puts them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type LayoutResult, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { edit } from "../src/edit/edit.js";
import { readProject } from "../src/io/project.js";
import { TEMPLATES } from "../src/layout/templates/index.js";
import type { DrawnPin } from "../src/render/model.js";
import {
  ACTIVE_LOWPASS, INTEGRATOR, INVERTING, NONINVERTING, RELAXATION_OSCILLATOR, SALLEN_KEY_HIGHPASS_GAIN, SALLEN_KEY_LOWPASS, SALLEN_KEY_TWO_STAGE, WIEN_BRIDGE,
} from "./support/template-circuits.js";

const run = (p: Project) => { const r = layout(p); return { r, q: checkDrawing(p.circuit, r.pinDefs, r.render!) }; };
const pinAt = (r: LayoutResult, part: string, n: string): DrawnPin => r.render!.electrical.pins.find((p) => p.part === part && p.number === n)!;
const xy = (r: LayoutResult, part: string, n: string) => pinAt(r, part, n).at;
/** A two-pin part's pins, left to right or top to bottom. */
const ends = (r: LayoutResult, part: string) => [xy(r, part, "1"), xy(r, part, "2")].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const horizontal = (r: LayoutResult, part: string) => { const [a, b] = ends(r, part); return a![1] === b![1]; };
const vertical = (r: LayoutResult, part: string) => { const [a, b] = ends(r, part); return a![0] === b![0]; };
const row = (r: LayoutResult, part: string) => ends(r, part)[0]![1];
const column = (r: LayoutResult, part: string) => ends(r, part)[0]![0];
const clean = (q: ReturnType<typeof run>["q"]) => [q.valid, q.metrics.crossings, q.conventions, q.breaches];
const CLEAN = [true, 0, [], []];
// Op-amp pins: 2 is IN-, 3 is IN+, 1 is OUT.
const INM = "2", INP = "3", OUT = "1";

describe("Sallen-Key filters", () => {
  it("low-pass, unity gain: series resistors in line into IN+, C1 above, C2 hanging from the IN+ line", () => {
    const { r, q } = run(SALLEN_KEY_LOWPASS);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "sallen-key-lowpass@1:C1,C2,R1,R2,U1"]);
    expect(clean(q)).toEqual(CLEAN);
    const inp = xy(r, "U1", INP), inm = xy(r, "U1", INM);
    expect(inp[1]).toBeLessThan(inm[1]); // IN+ on top
    expect([horizontal(r, "R1"), horizontal(r, "R2"), row(r, "R1"), row(r, "R2")]).toEqual([true, true, inp[1], inp[1]]);
    expect(ends(r, "R1")[1]![0]).toBeLessThan(ends(r, "R2")[0]![0]);
    expect(ends(r, "R2")[1]![0]).toBeLessThan(inp[0]);
    // The feedback capacitor lies above the series line; the shunt capacitor stands under it.
    expect([horizontal(r, "C1"), row(r, "C1") < inp[1]]).toEqual([true, true]);
    expect([vertical(r, "C2"), ends(r, "C2")[0]![1] > inp[1]]).toEqual([true, true]);
    expect(column(r, "C2")).toBeGreaterThan(ends(r, "R2")[1]![0]);
    expect(column(r, "C2")).toBeLessThan(inp[0]);
  });

  it("low-pass, unity gain: the output returns under the op-amp to IN-, and no node on the output line is four-way", () => {
    const { r } = run(SALLEN_KEY_LOWPASS);
    const out = xy(r, "U1", OUT), inm = xy(r, "U1", INM);
    const el = r.render!.electrical;
    // Two nodes on the output row: the tap column (down to IN-) and, 2 G on, the feedback column (up to C1).
    expect(el.dots.filter((d) => d[1] === out[1] && d[0] > out[0]).map((d) => d[0] - out[0]).sort((a, b) => a - b)).toEqual([2, 4]);
    // A run below the op-amp from the tap column back to the column left of IN-.
    expect(el.wires.some((w) => w.length === 2 && w[0]![1] === w[1]![1] && w[0]![1] > inm[1]
      && Math.min(w[0]![0], w[1]![0]) === inm[0] - 2 && Math.max(w[0]![0], w[1]![0]) === out[0] + 2)).toBe(true);
  });

  it("high-pass with gain: series capacitors in line, R1 above, R2 hanging, and the gain network below as in the non-inverting amplifier", () => {
    const { r, q } = run(SALLEN_KEY_HIGHPASS_GAIN);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "sallen-key-highpass-gain@1:C1,C2,R1,R2,R3,R4,U1"]);
    expect(clean(q)).toEqual(CLEAN);
    const inp = xy(r, "U1", INP), inm = xy(r, "U1", INM);
    expect([row(r, "C1"), row(r, "C2"), horizontal(r, "C1"), horizontal(r, "C2")]).toEqual([inp[1], inp[1], true, true]);
    expect([horizontal(r, "R1"), row(r, "R1") < inp[1], vertical(r, "R2")]).toEqual([true, true, true]);
    // Gain network: R3 lies below the op-amp, R4 stands below the node left of IN-.
    expect([horizontal(r, "R3"), row(r, "R3") > inm[1], vertical(r, "R4"), column(r, "R4") < inm[0], ends(r, "R4")[0]![1] > row(r, "R3")]).toEqual([true, true, true, true, true]);
    // The shunt resistor and the ground resistor stand apart.
    expect(column(r, "R2")).toBeLessThan(column(r, "R4"));
  });

  it("with a gain network the whole filter is one region: the non-inverting template does not split it", () => {
    const { r } = run(SALLEN_KEY_HIGHPASS_GAIN);
    expect(r.state!.templates!.some((t) => t.startsWith("opamp-noninverting"))).toBe(false);
    expect(r.blocks!.find((b) => b.parts.includes("U1"))!.parts.sort()).toEqual(["C1", "C2", "R1", "R2", "R3", "R4", "U1"]);
  });

  it("two stages in a row: both match, left to right, and the second starts clear of the first one's feedback column", () => {
    const { r, q } = run(SALLEN_KEY_TWO_STAGE);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "sallen-key-lowpass@1:C1,C2,R1,R2,U1", "sallen-key-lowpass@1:C3,C4,R3,R4,U2"]);
    expect(clean(q)).toEqual(CLEAN);
    expect(Object.fromEntries(r.blocks!.map((b) => [b.parts[0], b.rank]))).toEqual({ V1: 0, U1: 1, U2: 2, RL: 3 });
    // Stage 1 takes its feedback up at OUT.x + 4 (a reserved column); R3 starts to the right of it.
    const out1 = xy(r, "U1", OUT);
    expect(ends(r, "R3")[0]![0]).toBeGreaterThan(out1[0] + 4);
    expect(row(r, "R3")).toBe(out1[1]);
  });
});

describe("inverting stages with a capacitor", () => {
  it("integrator: the input in line with IN-, the capacitor above the op-amp", () => {
    const { r, q } = run(INTEGRATOR);
    expect(r.state!.templates).toEqual(["opamp-integrator@1:C1,R1,U1,V1", "pull-down@1:RL"]);
    expect(clean(q)).toEqual(CLEAN);
    const inm = xy(r, "U1", INM);
    expect([horizontal(r, "R1"), row(r, "R1"), horizontal(r, "C1"), row(r, "C1") < inm[1]]).toEqual([true, inm[1], true, true]);
  });

  it("low-pass: the capacitor above the feedback resistor, centred on it, between the same two columns", () => {
    const { r, q } = run(ACTIVE_LOWPASS);
    expect(r.state!.templates).toEqual(["opamp-inverting-lowpass@1:C1,R1,R2,U1,V1", "pull-down@1:RL"]);
    expect(clean(q)).toEqual(CLEAN);
    const inm = xy(r, "U1", INM), out = xy(r, "U1", OUT);
    expect([horizontal(r, "R2"), horizontal(r, "C1")]).toEqual([true, true]);
    expect(row(r, "C1")).toBeLessThan(row(r, "R2"));
    expect(row(r, "R2")).toBeLessThan(inm[1]);
    const mid = (part: string) => (ends(r, part)[0]![0] + ends(r, part)[1]![0]) / 2;
    expect(mid("C1")).toBe(mid("R2"));
    // The node column and the tap column each carry two nodes besides their own ends: R2's and IN-'s, R2's and OUT's.
    const dots = r.render!.electrical.dots;
    expect(dots.filter((d) => d[0] === inm[0] - 3).length).toBe(2);
    expect(dots.filter((d) => d[0] === out[0] + 2).length).toBe(2);
  });

  it("leave the plain amplifiers to their own templates", () => {
    expect(run(INVERTING).r.state!.templates).toEqual(["opamp-inverting@1:R1,R2,U1,V1", "pull-down@1:RL"]);
    expect(run(NONINVERTING).r.state!.templates).toEqual(["opamp-noninverting@1:Rf,Rg,U1", "pull-down@1:RL"]);
  });
});

describe("oscillators", () => {
  it("relaxation oscillator: timing resistor above, timing capacitor hanging on the left, the divider below", () => {
    const { r, q } = run(RELAXATION_OSCILLATOR);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "relaxation-oscillator@1:C1,R1,R2,R3,U1"]);
    expect(clean(q)).toEqual(CLEAN);
    const inm = xy(r, "U1", INM), inp = xy(r, "U1", INP);
    expect(inm[1]).toBeLessThan(inp[1]); // IN- on top
    expect([horizontal(r, "R3"), row(r, "R3") < inm[1]]).toEqual([true, true]);
    expect([vertical(r, "C1"), column(r, "C1") < inp[0] - 2, ends(r, "C1")[0]![1]]).toEqual([true, true, inm[1] + 2]);
    expect([horizontal(r, "R1"), row(r, "R1") > inp[1]]).toEqual([true, true]);
    expect([vertical(r, "R2"), column(r, "R2"), ends(r, "R2")[0]![1] > row(r, "R1")]).toEqual([true, inp[0] - 2, true]);
  });

  it("an oscillator has no input: it is where the signal starts, and its load goes to its right", () => {
    for (const p of [RELAXATION_OSCILLATOR, WIEN_BRIDGE]) {
      const { r } = run(p);
      const rank = Object.fromEntries(r.blocks!.map((b) => [b.parts[0], b.rank]));
      expect(rank.RL, p.meta!.title).toBeGreaterThan(rank.U1!);
      expect(column(r, "RL"), p.meta!.title).toBeGreaterThan(xy(r, "U1", OUT)[0]);
    }
  });

  it("Wien bridge: the series pair in one line above the op-amp, the parallel pair hanging side by side, the gain network below", () => {
    const { r, q } = run(WIEN_BRIDGE);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "wien-bridge-cr@1:C1,C2,R1,R2,R3,R4,U1"]);
    expect(clean(q)).toEqual(CLEAN);
    const inp = xy(r, "U1", INP), inm = xy(r, "U1", INM);
    expect(inp[1]).toBeLessThan(inm[1]); // IN+ on top
    expect([horizontal(r, "R1"), horizontal(r, "C1"), row(r, "R1") === row(r, "C1"), row(r, "C1") < inp[1]]).toEqual([true, true, true, true]);
    expect(ends(r, "C1")[1]![0]).toBeLessThan(ends(r, "R1")[0]![0]); // the capacitor is on the IN+ side in this circuit
    expect([vertical(r, "R2"), vertical(r, "C2"), ends(r, "R2")[0]![1], ends(r, "C2")[0]![1]]).toEqual([true, true, inp[1] + 2, inp[1] + 2]);
    expect(column(r, "R2")).toBeLessThan(column(r, "C2"));
    expect(column(r, "C2")).toBeLessThan(inp[0]);
    expect([horizontal(r, "R3"), row(r, "R3") > inm[1], vertical(r, "R4"), column(r, "R4")]).toEqual([true, true, true, inm[0] - 2]);
  });

  it("Wien bridge with the series pair the other way round (resistor on the IN+ side) matches its own variant", () => {
    const swapped: Project = { ...WIEN_BRIDGE, circuit: { ...WIEN_BRIDGE.circuit, nets: WIEN_BRIDGE.circuit.nets.map((n) =>
      n.id === "n2" ? { ...n, endpoints: ["R1.1", "U1.IN+", "R2.1", "C2.1"] } : n.id === "n4" ? { ...n, endpoints: ["U1.OUT", "C1.2", "R3.2", "RL.1"] } : n) } };
    const { r, q } = run(swapped);
    expect(r.state!.templates).toEqual(["pull-down@1:RL", "wien-bridge-rc@1:C1,C2,R1,R2,R3,R4,U1"]);
    expect(clean(q)).toEqual(CLEAN);
    expect(ends(r, "R1")[1]![0]).toBeLessThan(ends(r, "C1")[0]![0]);
  });
});

describe("mechanics of the new templates", () => {
  const ids = ["sallen-key-lowpass", "sallen-key-lowpass-gain", "sallen-key-highpass", "sallen-key-highpass-gain",
    "opamp-inverting-lowpass", "opamp-integrator", "relaxation-oscillator", "wien-bridge-rc", "wien-bridge-cr"];

  it("are in the library, each with a unique id", () => {
    const all = TEMPLATES.map((t) => t.id);
    for (const id of ids) expect(all.filter((x) => x === id), id).toEqual([id]);
  });

  it("only the templates that turn the output up outside their parts reserve a column", () => {
    expect(TEMPLATES.filter((t) => t.reserve).map((t) => t.id).sort()).toEqual(ids.filter((id) => !id.startsWith("opamp-")).sort());
  });

  it("pin order in the file does not matter: every two-pin part reversed gives the same template and a clean drawing", () => {
    for (const p of [SALLEN_KEY_LOWPASS, SALLEN_KEY_HIGHPASS_GAIN, INTEGRATOR, ACTIVE_LOWPASS, RELAXATION_OSCILLATOR, WIEN_BRIDGE]) {
      const twoPin = new Set(p.circuit.parts.filter((x) => x.type === "resistor" || x.type === "capacitor").map((x) => x.id));
      const flip = (e: string) => { const [part, pin] = e.split("."); return twoPin.has(part!) ? `${part}.${pin === "1" ? "2" : "1"}` : e; };
      const flipped: Project = { ...p, circuit: { ...p.circuit, nets: p.circuit.nets.map((n) => ({ ...n, endpoints: n.endpoints.map(flip) })) } };
      const a = run(p), b = run(flipped);
      expect(b.r.state!.templates, p.meta!.title).toEqual(a.r.state!.templates);
      expect(clean(b.q), p.meta!.title).toEqual(CLEAN);
    }
  });

  it("an edit keeps the template: a longer value on the feedback capacitor redraws the filter in the same shape", () => {
    const base = layout(SALLEN_KEY_LOWPASS);
    const r = edit({ project: SALLEN_KEY_LOWPASS, previous: base.state!, ops: [{ op: "setProp", part: "C1", key: "value", value: "220n" }] });
    expect([r.saved, r.status]).toEqual([true, "valid"]);
    expect(r.layout!.state!.templates).toEqual(base.state!.templates);
    expect(clean(r.check!)).toEqual(CLEAN);
    for (const id of ["U1", "R1", "R2", "C2"]) expect(xy(r.layout!, id, "1"), id).toEqual(xy(base, id, "1"));
  });

  it("an edit may break the pattern: with the feedback capacitor removed the filter is drawn by the general rules, still valid", () => {
    const base = layout(SALLEN_KEY_LOWPASS);
    const r = edit({ project: SALLEN_KEY_LOWPASS, previous: base.state!, ops: [{ op: "removePart", part: "C1" }] });
    expect(r.saved).toBe(true);
    expect((r.layout!.state!.templates ?? []).some((t) => t.startsWith("sallen-key"))).toBe(false);
    expect(r.check!.valid).toBe(true);
  });
});

describe("examples and docs", () => {
  const ROOT = join(import.meta.dirname, "..");

  it("the three example files draw valid, each through its template", () => {
    const expected: Record<string, string[]> = {
      "sallen-key-filter": ["pull-down@1:RL", "sallen-key-lowpass@1:C1,C2,R1,R2,U1", "sallen-key-lowpass@1:C3,C4,R3,R4,U2"],
      "wien-bridge": ["wien-bridge-cr@1:C1,C2,R1,R2,R3,R4,U1"],
      "relaxation-oscillator": ["relaxation-oscillator@1:C1,R1,R2,R3,U1"],
    };
    for (const [name, templates] of Object.entries(expected)) {
      const project = readProject(join(ROOT, "examples", `${name}.schem.json`)).project!;
      const r = layout(project);
      expect(r.status, name).toBe("valid");
      expect(r.state!.templates, name).toEqual(templates);
      expect(clean(checkDrawing(project.circuit, r.pinDefs, r.render!)), name).toEqual(CLEAN);
    }
  });

  it("docs/templates.md names every template in the library", () => {
    const doc = readFileSync(join(ROOT, "docs", "templates.md"), "utf8");
    expect(TEMPLATES.map((t) => t.id).filter((id) => !doc.includes(`\`${id}\``))).toEqual([]);
  });
});
