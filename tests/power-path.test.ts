// Series power path (SPEC 9.2 step 3): a fuse, switch, regulator, diode, inductor
// or high-side transistor between two supply nets is drawn in the wire.

import { describe, expect, it } from "vitest";
import { validate } from "../src/core/validate.js";
import type { Circuit, PinDef } from "../src/core/model.js";
import { layout, pinDefsOf, type Project } from "../src/layout/layout.js";
import { powerPath } from "../src/layout/power-path.js";
import type { Electrical } from "../src/render/model.js";
import { toSvg } from "../src/render/svg.js";
import { verify } from "../src/verify/verify.js";

function classify(circuit: Circuit, extra: Record<string, PinDef[]> = {}) {
  const defs = { ...pinDefsOf(circuit), ...extra };
  const v = validate(circuit, defs);
  expect(v.issues, v.issues.map((i) => i.message).join("\n")).toEqual([]);
  return powerPath(circuit, defs, v.valid!);
}

function draw(circuit: Circuit) {
  const project: Project = { meta: { title: "power path" }, circuit };
  const r = layout(project);
  expect(r.status, [...r.issues, ...r.notes].join(" | ")).toBe("valid");
  const el = r.render!.electrical;
  expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
  expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
  return { r, el };
}

function at(el: Electrical, part: string, number: string) {
  const p = el.pins.find((q) => q.part === part && q.number === number);
  if (!p) throw new Error(`pin ${part}[${number}] was not drawn`);
  return p.at;
}
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
const wireAt = (el: Electrical, part: string, number: string) => el.wires.some((w) => w.some((p) => same(p, at(el, part, number))));
const portAt = (el: Electrical, part: string, number: string) => el.ports.some((p) => same(p.at, at(el, part, number)));
const portsNamed = (el: Electrical, text: string) => el.ports.filter((p) => p.text === text);

describe("classification", () => {
  it("leaves a flyback diode off the power path", () => {
    const path = classify({
      parts: [
        { id: "R1", type: "resistor" }, { id: "R2", type: "resistor" }, { id: "R3", type: "resistor" },
        { id: "D1", type: "diode" },
      ],
      nets: [
        { id: "n1", name: "5V", endpoints: ["R1[1]", "R2[1]", "D1[K]"] },
        { id: "n2", endpoints: ["D1[A]", "R3[1]"] },
        { id: "n3", name: "GND", endpoints: ["R1[2]", "R2[2]", "R3[2]"] },
      ],
    });
    expect(path.notes).toEqual([]);
    expect(path.continuePins.size).toBe(0);
    expect(path.wireNets.size).toBe(0);
  });

  it("does not treat a low-side transistor as a high-side switch", () => {
    const path = classify({
      parts: [
        { id: "Q1", type: "npn" }, { id: "R1", type: "resistor" }, { id: "R2", type: "resistor" }, { id: "R3", type: "resistor" },
      ],
      nets: [
        { id: "n1", name: "VCC", endpoints: ["R1[1]", "R2[1]", "R3[1]"] },
        { id: "n2", endpoints: ["R1[2]", "Q1[C]"] },
        { id: "n3", endpoints: ["R2[2]", "Q1[B]"] },
        { id: "n4", name: "GND", endpoints: ["Q1[E]", "R3[2]"] },
      ],
    });
    expect(path.continuePins.size).toBe(0);
  });

  it("marks a fuse and a source on a loaded supply, and wires a supply that has no load", () => {
    const path = classify({
      parts: [
        { id: "B1", type: "battery" }, { id: "F1", type: "fuse" }, { id: "SW1", type: "spst" },
        { id: "C1", type: "capacitor" }, { id: "R1", type: "resistor" },
      ],
      nets: [
        { id: "nBat", name: "VBAT", endpoints: ["B1[+]", "F1[1]", "SW1[1]"] },
        { id: "nIn", name: "VIN", endpoints: ["F1[2]", "C1[1]", "R1[1]"] },
        { id: "nSw", name: "VCC", endpoints: ["SW1[2]", "R1[2]"] },
        { id: "nGnd", name: "GND", endpoints: ["B1[-]", "C1[2]"] },
      ],
    });
    expect([...path.wireNets]).toEqual(["nBat"]);
    expect(path.continuePins.has("F1[2]")).toBe(true);
    expect(path.continuePins.has("C1[1]")).toBe(false);
    expect(path.continuePins.has("B1[+]") ).toBe(false);
    expect(path.notes).toContain("power path: F1 joins VBAT to VIN");
    expect(path.notes).toContain("power path: SW1 joins VBAT to VCC");
  });

  it("marks a high-side MOSFET on both supply nets, and not its gate", () => {
    const path = classify({
      parts: [
        { id: "Q1", type: "pmos" }, { id: "B1", type: "battery" }, { id: "C1", type: "capacitor" },
        { id: "R1", type: "resistor" }, { id: "R2", type: "resistor" }, { id: "R3", type: "resistor" },
      ],
      nets: [
        { id: "n1", name: "VBAT", endpoints: ["B1[+]", "C1[1]", "Q1[S]"] },
        { id: "n2", name: "VCC", endpoints: ["Q1[D]", "R1[1]", "R2[1]"] },
        { id: "n3", endpoints: ["Q1[G]", "R3[1]"] },
        { id: "n4", name: "GND", endpoints: ["B1[-]", "C1[2]", "R1[2]", "R2[2]", "R3[2]"] },
      ],
    });
    expect(path.continuePins.has("Q1[S]")).toBe(true);
    expect(path.continuePins.has("Q1[D]")).toBe(true);
    expect(path.continuePins.has("Q1[G]")).toBe(false);
    expect(path.continuePins.has("B1[+]") ).toBe(true);
  });

  it("treats an inductor between two supply nets as a series element", () => {
    // The inductor symbol is not in this build. The classifier only needs the pin list.
    const path = classify({
      parts: [
        { id: "L1", type: "inductor" },
        { id: "R1", type: "resistor" }, { id: "R2", type: "resistor" }, { id: "R3", type: "resistor" },
      ],
      nets: [
        { id: "n1", name: "VIN", endpoints: ["L1[1]", "R1[1]", "R2[1]"] },
        { id: "n2", name: "VOUT", kind: "power", endpoints: ["L1[2]", "R2[2]", "R3[1]"] },
        { id: "n3", name: "GND", endpoints: ["R1[2]", "R3[2]"] },
      ],
    }, {
      L1: [{ number: "1", name: "1", role: "passive" }, { number: "2", name: "2", role: "passive" }],
    });
    expect(path.continuePins.has("L1[1]")).toBe(true);
    expect(path.continuePins.has("L1[2]")).toBe(true);
    expect(path.notes).toEqual(["power path: L1 joins VIN to VOUT"]);
  });

  it("marks a regulator by its power_in and power_out pins", () => {
    const path = classify({
      parts: [
        { id: "U1", type: "module:test-reg", pins: [
          { number: "1", name: "VIN", role: "power_in" },
          { number: "2", name: "GND", role: "ground" },
          { number: "3", name: "VOUT", role: "power_out" },
        ] },
        { id: "C1", type: "capacitor" }, { id: "C2", type: "capacitor" }, { id: "R1", type: "resistor" },
      ],
      nets: [
        { id: "n1", name: "VIN", endpoints: ["U1[1]", "C1[1]", "R1[1]"] },
        { id: "n2", name: "5V", endpoints: ["U1[3]", "C2[1]", "R1[2]"] },
        { id: "n3", name: "GND", endpoints: ["U1[2]", "C1[2]", "C2[2]"] },
      ],
    });
    expect(path.continuePins.has("U1[1]")).toBe(true);
    expect(path.continuePins.has("U1[3]")).toBe(true);
    expect(path.continuePins.has("U1[2]")).toBe(false);
  });
});

describe("drawings", () => {
  const fuse: Circuit = {
    parts: [
      { id: "B1", type: "battery", props: { value: "9V" } },
      { id: "F1", type: "fuse" },
      { id: "C1", type: "capacitor", props: { value: "100n" } },
      { id: "R1", type: "resistor", props: { value: "470" } },
      { id: "D1", type: "led", props: { color: "red" } },
    ],
    nets: [
      { id: "n1", name: "VBAT", endpoints: ["B1[+]", "F1[1]", "C1[1]"] },
      { id: "n2", name: "VIN", endpoints: ["F1[2]", "R1[1]"] },
      { id: "n3", endpoints: ["R1[2]", "D1[A]"] },
      { id: "n4", name: "GND", endpoints: ["B1[-]", "C1[2]", "D1[K]"] },
    ],
  };

  it("draws the fuse in the wire and keeps one VBAT symbol on the capacitor", () => {
    const { el, r } = draw(fuse);
    expect(r.notes).toContain("power path: F1 joins VBAT to VIN");
    expect(wireAt(el, "F1", "1")).toBe(true);
    expect(wireAt(el, "B1", "+")).toBe(true);
    expect(portAt(el, "F1", "1")).toBe(false);
    expect(portAt(el, "B1", "+")).toBe(false);
    expect(portsNamed(el, "VBAT")).toHaveLength(1);
    expect(wireAt(el, "C1", "1")).toBe(true);
  });

  it("draws a supply with only path pins as wires and no supply symbol", () => {
    const { el } = draw({
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "F1", type: "fuse" },
        { id: "SW1", type: "spst" },
        { id: "R1", type: "resistor", props: { value: "470" } },
        { id: "R2", type: "resistor", props: { value: "1k" } },
        { id: "D1", type: "led", props: { color: "red" } },
      ],
      nets: [
        { id: "n1", name: "VBAT", endpoints: ["B1[+]", "F1[1]", "SW1[1]"] },
        { id: "n2", name: "VIN", endpoints: ["F1[2]", "R1[1]"] },
        { id: "n3", name: "VCC", endpoints: ["SW1[2]", "R2[1]"] },
        { id: "n4", endpoints: ["R1[2]", "D1[A]"] },
        { id: "n5", name: "GND", endpoints: ["B1[-]", "R2[2]", "D1[K]"] },
      ],
    });
    expect(portsNamed(el, "VBAT")).toHaveLength(0);
    expect(wireAt(el, "B1", "+")).toBe(true);
    expect(wireAt(el, "F1", "1")).toBe(true);
    expect(wireAt(el, "SW1", "1")).toBe(true);
  });

  it("draws a high-side MOSFET between two supply nets", () => {
    const { el, r } = draw({
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "Q1", type: "pmos" },
        { id: "C1", type: "capacitor", props: { value: "100n" } },
        { id: "R1", type: "resistor", props: { value: "10k" } },
        { id: "R2", type: "resistor", props: { value: "470" } },
        { id: "R3", type: "resistor", props: { value: "470" } },
        { id: "D1", type: "led", props: { color: "red" } },
      ],
      nets: [
        { id: "n1", name: "VBAT", endpoints: ["B1[+]", "C1[1]", "Q1[S]"] },
        { id: "n2", name: "VCC", endpoints: ["Q1[D]", "R2[1]", "R3[1]"] },
        { id: "n3", endpoints: ["Q1[G]", "R1[1]"] },
        { id: "n4", endpoints: ["R2[2]", "D1[A]"] },
        { id: "n5", name: "GND", endpoints: ["B1[-]", "C1[2]", "R1[2]", "R3[2]", "D1[K]"] },
      ],
    });
    expect(r.notes.some((n) => n.startsWith("power path: Q1 "))).toBe(true);
    expect(wireAt(el, "Q1", "S")).toBe(true);
    expect(wireAt(el, "Q1", "D")).toBe(true);
    expect(portAt(el, "Q1", "S")).toBe(false);
    expect(portAt(el, "Q1", "D")).toBe(false);
    expect(portsNamed(el, "VBAT").length).toBeGreaterThan(0);
    expect(portsNamed(el, "VCC").length).toBeGreaterThan(0);
  });

  it("draws a regulator's output pin as a wire into the 5V symbols", () => {
    const { el } = draw({
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "F1", type: "fuse" },
        { id: "C1", type: "capacitor", props: { value: "10u" } },
        { id: "U1", type: "module:test-reg", pins: [
          { number: "1", name: "VIN", role: "power_in" },
          { number: "2", name: "GND", role: "ground" },
          { number: "3", name: "VOUT", role: "power_out" },
        ] },
        { id: "C2", type: "capacitor", props: { value: "100n" } },
        { id: "R1", type: "resistor", props: { value: "470" } },
        { id: "D1", type: "led", props: { color: "red" } },
      ],
      nets: [
        { id: "n1", name: "VBAT", endpoints: ["B1[+]", "F1[1]", "C1[1]"] },
        { id: "n2", name: "VIN", endpoints: ["F1[2]", "U1[1]"] },
        { id: "n3", name: "5V", endpoints: ["U1[3]", "C2[1]", "R1[1]"] },
        { id: "n4", endpoints: ["R1[2]", "D1[A]"] },
        { id: "n5", name: "GND", endpoints: ["B1[-]", "C1[2]", "U1[2]", "C2[2]", "D1[K]"] },
      ],
    });
    expect(wireAt(el, "U1", "3")).toBe(true);
    expect(portAt(el, "U1", "3")).toBe(false);
    expect(portsNamed(el, "5V")).toHaveLength(2);
    expect(wireAt(el, "F1", "1")).toBe(true);
  });

  it("still draws an ordinary supply as a symbol on every pin", () => {
    // No series element, so every pin of VCC keeps its own symbol. The supply is drawn
    // as symbols, which do not carry flow, so parts other than the battery are ranked
    // on their own and the status may be low confidence. That ranking is unchanged.
    const circuit: Circuit = {
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "R1", type: "resistor", props: { value: "10k" } },
        { id: "R2", type: "resistor", props: { value: "10k" } },
        { id: "R3", type: "resistor", props: { value: "10k" } },
      ],
      nets: [
        { id: "n1", name: "VCC", endpoints: ["B1[+]", "R1[1]", "R2[1]", "R3[1]"] },
        { id: "n2", name: "GND", endpoints: ["B1[-]", "R1[2]", "R2[2]", "R3[2]"] },
      ],
    };
    const r = layout({ circuit });
    expect(r.status === "valid" || r.status === "valid_low_confidence", r.issues.join(" | ")).toBe(true);
    const el = r.render!.electrical;
    expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
    expect(r.notes.filter((n) => n.startsWith("power path:"))).toEqual([]);
    expect(portsNamed(el, "VCC")).toHaveLength(4);
    for (const id of ["B1", "R1", "R2", "R3"]) expect(portAt(el, id, id === "B1" ? "+" : "1")).toBe(true);
    for (const id of ["R1", "R2", "R3"]) expect(wireAt(el, id, "1")).toBe(false);
  });
});
