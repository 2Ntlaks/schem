// Verification layers 2-4 (docs/verification-stack.html): each check passes the clean
// drawings and catches a deliberate break, as the verifier's mutation tests do for layer 1.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type Placement, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { checkOverlaps } from "../src/quality/overlap.js";
import { checkConventions } from "../src/quality/conventions.js";
import { textBox } from "../src/quality/drawing.js";
import { limitBreaches, measureDrawing } from "../src/quality/metrics.js";
import type { Art, RenderModel } from "../src/render/model.js";
import type { Pt } from "../src/geom/geom.js";

const dir = join(import.meta.dirname, "..", "cases");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Project;
const drawn = (p: Project, place?: Placement) => {
  const r = layout(p, place ? { place } : {});
  return { r, m: r.render! };
};
const codes = (m: RenderModel) => checkOverlaps(m).map((i) => i.code);
const moveOwner = (m: RenderModel, owner: string, to: (a: Extract<Art, { t: "text" }>, i: number) => Pt): RenderModel => {
  let i = 0;
  return { ...m, art: m.art.map((a) => (a.t === "text" && a.owner === owner ? (() => { const [x, y] = to(a, i++); return { ...a, x, y }; })() : a)) };
};

describe("layer 2: overlaps, grid and sheet", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const { m } = drawn(load(f));
    describe(f, () => {
      it("the clean drawing has no overlaps", () => expect(checkOverlaps(m)).toEqual([]));

      it("a label moved onto another label is caught", () => {
        const labels = [...new Set(m.art.flatMap((a) => (a.t === "text" && a.owner?.startsWith("label:") ? [a.owner] : [])))];
        const box = (o: string) => textBox(m.art.find((a): a is Extract<Art, { t: "text" }> => a.t === "text" && a.owner === o)!);
        const [from, to] = [box(labels[0]!), box(labels[1]!)];
        const moved = moveOwner(m, labels[0]!, (a) => [a.x + to.x - from.x, a.y + to.y - from.y]);
        expect(codes(moved)).toContain("text-overlap");
      });

      it("a label moved onto another part is caught", () => {
        const owner = m.art.find((a) => a.t === "text" && a.owner?.startsWith("label:"))!;
        const own = (owner as Extract<Art, { t: "text" }>).owner!.slice(6);
        const other = m.electrical.keepouts!.find((k) => !k.part.includes(":") && k.part !== own)!;
        const moved = moveOwner(m, (owner as Extract<Art, { t: "text" }>).owner!, (_, i) => [other.x + other.w / 2, other.y + other.h / 2 - 0.5 + i * 1.5]);
        expect(codes(moved)).toContain("text-on-part");
      });

      it("text pushed off the sheet is caught", () => {
        const owner = (m.art.find((a) => a.t === "text") as Extract<Art, { t: "text" }>).owner!;
        expect(codes(moveOwner(m, owner, (a) => [m.bounds.x + m.bounds.w + 1, a.y]))).toContain("text-clipped");
      });

      it("a wire run through a label is caught", () => {
        const t = m.art.find((a): a is Extract<Art, { t: "text" }> => a.t === "text" && !!a.owner?.startsWith("label:"))!;
        const y = Math.round(t.y + 0.5);
        const wire: Pt[] = [[Math.floor(t.x) - 3, y], [Math.ceil(t.x) + 6, y]];
        expect(codes({ ...m, electrical: { ...m.electrical, wires: [...m.electrical.wires, wire] } })).toContain("wire-on-text");
      });

      it("an off-grid pin is caught", () => {
        const pins = m.electrical.pins.map((p, i) => (i === 0 ? { ...p, at: [p.at[0] + 0.5, p.at[1]] as Pt } : p));
        expect(codes({ ...m, electrical: { ...m.electrical, pins } })).toContain("off-grid");
      });

      it("two parts on top of each other are caught", () => {
        const parts = m.electrical.keepouts!.filter((k) => !k.part.includes(":"));
        const copy = { ...parts[0]!, part: `${parts[0]!.part}-copy`, x: parts[1]!.x, y: parts[1]!.y };
        expect(codes({ ...m, electrical: { ...m.electrical, keepouts: [...m.electrical.keepouts!, copy] } })).toContain("part-overlap");
      });
    });
  }
});

// A small board: a resistor across the supply, a pull-up, a load to ground, a decoupled IC.
const board: Project = {
  circuit: {
    parts: [
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "R2", type: "resistor", props: { value: "4.7k" } },
      { id: "R3", type: "resistor", props: { value: "1k" } },
      { id: "C1", type: "capacitor", props: { value: "100n" } },
      { id: "U1", type: "ic", props: { label: "MCU", controller: "true" }, pins: [
        { number: "1", name: "VCC", role: "power_in" }, { number: "2", name: "GND", role: "ground" }, { number: "3", name: "IO", role: "bidir" },
      ] },
    ],
    nets: [
      { id: "n1", name: "VCC", endpoints: ["R1.1", "R2.1", "C1.1", "U1.VCC"] },
      { id: "n2", name: "GND", endpoints: ["R1.2", "R3.2", "C1.2", "U1.GND"] },
      { id: "n3", name: "IO", endpoints: ["U1.IO", "R2.2", "R3.1"] },
    ],
  },
};

describe("layer 3: conventions", () => {
  const ids = (p: Project, place?: Placement) => { const { r, m } = drawn(p, place); return checkConventions(p.circuit, r.pinDefs, m).map((f) => f.id.replace(/-\d+,\d+$/, "")); };

  it("the Phase 0a cases follow every checked convention", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const p = load(f);
      const { r, m } = drawn(p);
      expect(checkConventions(p.circuit, r.pinDefs, m), f).toEqual([]);
    }
  });

  it("the board, laid out normally, breaks only rule 13 (no decoupling template until Phase 0b)", () => {
    expect(ids(board)).toEqual(["C13-C1"]);
  });

  // Fixed placements that break one convention each.
  const base: Placement = {
    U1: { at: [0, 0] },
    R1: { at: [30, 6], orient: { rot: 90, flip: false } },
    R2: { at: [16, 0], orient: { rot: 90, flip: false } },
    R3: { at: [22, 12], orient: { rot: 90, flip: false } },
    C1: { at: [8, 18], orient: { rot: 90, flip: false } },
  };

  it("a resistor across the supply drawn sideways is caught (rule 10)", () => {
    expect(ids(board, { ...base, R1: { at: [30, 6], orient: { rot: 0, flip: false } } })).toContain("C10-R1");
  });

  it("a pull-up drawn sideways is caught (template 9.4)", () => {
    expect(ids(board, { ...base, R2: { at: [16, 4], orient: { rot: 180, flip: false } } })).toContain("C9.4-pull-R2");
  });

  it("a decoupling capacitor far from the chip is caught (rule 13)", () => {
    expect(ids(board, { ...base, C1: { at: [44, 20], orient: { rot: 90, flip: false } } })).toContain("C13-C1");
  });

  it("an upside-down ground connection is caught (rule 7)", () => {
    const p = load("case03-summing.json");
    const { r, m } = drawn(p);
    const g = m.electrical.ports.find((q) => q.kind === "ground")!;
    const pins = m.electrical.pins.map((q) => (q.at[0] === g.at[0] && q.at[1] === g.at[1] ? { ...q, dir: "up" as const } : q));
    const wires = m.electrical.wires.map((w) => w);
    const moved = { ...m, electrical: { ...m.electrical, pins, wires } };
    const hit = checkConventions(p.circuit, r.pinDefs, moved).map((f) => f.id);
    const hasPinAtPort = m.electrical.pins.some((q) => q.at[0] === g.at[0] && q.at[1] === g.at[1]);
    if (hasPinAtPort) expect(hit.some((h) => h.startsWith("C7-ground"))).toBe(true);
    else {
      // The port sits on a stub: make the stub arrive from below instead.
      const flipped = { ...m, electrical: { ...m.electrical, ports: m.electrical.ports.map((q) => (q === g ? { ...q, at: [g.at[0], g.at[1] - 2] as Pt } : q)) } };
      expect(checkConventions(p.circuit, r.pinDefs, flipped).map((f) => f.id).some((h) => h.startsWith("C7-ground"))).toBe(true);
    }
  });

  it("an upside-down source is caught (rule 7, sources)", () => {
    const p = load("case01-led.json");
    expect(ids({ ...p, intent: { hints: [{ id: "h1", type: "orient", part: "B1", rot: 270, flip: false, priority: "normal" }] } })).toContain("C7-source-B1");
  });

  it("two series resistors off one line are caught (rule 11)", () => {
    const chain: Project = { circuit: {
      parts: [{ id: "V1", type: "vsource", props: { value: "5V" } }, { id: "R1", type: "resistor" }, { id: "R2", type: "resistor" }, { id: "D1", type: "led" }],
      nets: [
        { id: "n1", endpoints: ["V1.+", "R1.1"] }, { id: "n2", endpoints: ["R1.2", "R2.1"] },
        { id: "n3", endpoints: ["R2.2", "D1.anode"] }, { id: "n4", name: "GND", endpoints: ["D1.cathode", "V1.-"] },
      ] } };
    expect(ids(chain)).not.toContain("C11-R1-R2");
    const place: Placement = {
      V1: { at: [0, 8], orient: { rot: 90, flip: false } }, R1: { at: [4, 4] }, R2: { at: [14, 8] },
      D1: { at: [24, 8], orient: { rot: 90, flip: false } },
    };
    expect(ids(chain, place)).toContain("C11-R1-R2");
  });

  it("an input left of its driver is caught (rule 8)", () => {
    // Two voltage followers in a row; each follower's own feedback is not backwards flow.
    const amps: Project = { circuit: {
      parts: [{ id: "V1", type: "vsource", props: { value: "1V" } }, { id: "U1", type: "opamp" }, { id: "U2", type: "opamp" }, { id: "RL", type: "resistor" }],
      nets: [
        { id: "n1", endpoints: ["V1.+", "U1.IN+"] }, { id: "n2", endpoints: ["U1.OUT", "U1.IN-", "U2.IN+"] },
        { id: "n3", endpoints: ["U2.OUT", "U2.IN-", "RL.1"] }, { id: "n4", name: "GND", endpoints: ["V1.-", "RL.2"] },
      ] } };
    expect(ids(amps)).toEqual([]);
    const place: Placement = {
      V1: { at: [30, 4], orient: { rot: 90, flip: false } }, U2: { at: [4, 6] }, U1: { at: [20, 6] },
      RL: { at: [40, 4], orient: { rot: 90, flip: false } },
    };
    expect(ids(amps, place)).toContain("C8-U2[3]");
  });
});

describe("layer 4: readability metrics", () => {
  const sheet = { x: -5, y: -5, w: 40, h: 30 };
  const model = (wires: Pt[][], dots: Pt[] = []): RenderModel => ({ electrical: { pins: [], wires, dots, ports: [], ncMarks: [], keepouts: [] }, art: [], bounds: sheet, meta: {} });

  it("counts crossings, bends, length and junctions", () => {
    const m = measureDrawing(model([[[0, 5], [10, 5]], [[5, 0], [5, 10]], [[0, 0], [3, 0], [3, 3]]]));
    expect([m.crossings, m.bends, m.wireLength, m.dots]).toEqual([1, 1, 26, 0]);
  });

  it("dots one step apart breach the spacing limit", () => {
    const m = measureDrawing(model([[[0, 0], [10, 0]], [[4, 0], [4, 5]], [[5, 0], [5, 5]]], [[4, 0], [5, 0]]));
    expect(m.minDotSpacing).toBe(1);
    expect(limitBreaches(m).map((b) => b.metric)).toContain("minDotSpacing");
  });

  it("a crossing beside a dot breaches its limit", () => {
    const m = measureDrawing(model([[[0, 0], [10, 0]], [[4, -3], [4, 3]], [[5, 0], [5, 4]]], [[5, 0]]));
    expect(m.minCrossingToDot).toBe(1);
    expect(limitBreaches(m).map((b) => b.metric)).toContain("minCrossingToDot");
  });

  it("a short step in a wire is a jog; a long one is not", () => {
    expect(measureDrawing(model([[[0, 0], [5, 0], [5, 1], [10, 1]]])).jogs).toBe(1);
    expect(measureDrawing(model([[[0, 0], [5, 0], [5, 6], [10, 6]]])).jogs).toBe(0);
  });

  it("two nets on adjacent tracks for 3 G or more are squeezed", () => {
    expect(measureDrawing(model([[[0, 0], [8, 0]], [[0, 1], [8, 1]]])).squeezedRuns).toBe(1);
    expect(measureDrawing(model([[[0, 0], [8, 0]], [[0, 2], [8, 2]]])).squeezedRuns).toBe(0);
  });

  it("an empty band on one side breaches the margin limit", () => {
    const m = measureDrawing(model([[[0, 0], [30, 0], [30, 20]]]));
    expect(m.marginImbalance).toBe(0);
    const tall = measureDrawing({ ...model([[[0, 0], [30, 0], [30, 20]]]), bounds: { x: -5, y: -15, w: 40, h: 40 } });
    expect(limitBreaches(tall).map((b) => b.metric)).toContain("marginImbalance");
  });

  // The weaknesses the owner saw in the 0a drawings are measured, and nothing else is.
  // When Phase 0b fixes one, its entry here is removed.
  const known: Record<string, string[]> = {
    "case01-led.json": [],
    "case03-summing.json": ["minDotSpacing", "jogs"],
    "case05-i2c.json": ["minCrossingToDot", "squeezedRuns"],
  };
  for (const [f, expected] of Object.entries(known)) {
    it(`${f}: limit breaches are exactly the known weaknesses`, () => {
      const p = load(f);
      const { r, m } = drawn(p);
      expect(checkDrawing(p.circuit, r.pinDefs, m).breaches.map((b) => b.metric).sort()).toEqual([...expected].sort());
    });
  }
});

describe("independence", () => {
  it("src/quality does not import the layout (it reads only the render model)", () => {
    const qdir = join(import.meta.dirname, "..", "src", "quality");
    for (const f of readdirSync(qdir)) expect(readFileSync(join(qdir, f), "utf8"), f).not.toMatch(/from "\.\.\/layout\//);
  });
});
