// How the general layout draws a regulator on the power path (src/layout/power-path.ts,
// src/layout/layout.ts): output on the right with its capacitors in a row beside it, input on the
// left unless it has decoupling capacitors for its top slots.

import { describe, expect, it } from "vitest";
import type { Circuit } from "../src/core/model.js";
import { layout, type Project } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";
import { verify } from "../src/verify/verify.js";
import { pathAnchors } from "../src/layout/power-path.js";

const reg = { id: "U1", type: "module:test-reg", pins: [
  { number: "1", name: "IN", role: "power_in" as const },
  { number: "2", name: "GND", role: "ground" as const },
  { number: "3", name: "OUT", role: "power_out" as const },
] };

/** A regulator from VIN to 5V with two output capacitors and an LED load; `inCaps` input capacitors. */
function regulator(inCaps: number): Circuit {
  const caps = Array.from({ length: inCaps }, (_, i) => ({ id: `C${i + 1}`, type: "capacitor", props: { value: i ? "100u" : "330n" } }));
  return {
    parts: [
      { id: "J1", type: "header", props: { label: "DC IN" }, pins: [
        { number: "1", name: "+", role: "passive" as const },
        { number: "2", name: "-", role: "passive" as const },
      ] },
      reg,
      ...caps,
      { id: "C8", type: "capacitor", props: { value: "10u" } },
      { id: "C9", type: "capacitor", props: { value: "100n" } },
      { id: "R1", type: "resistor", props: { value: "1k" } },
      { id: "D1", type: "led", props: { color: "green" } },
    ],
    nets: [
      { id: "n1", name: "VIN", endpoints: ["J1[1]", "U1[1]", ...caps.map((c) => `${c.id}[1]`)] },
      { id: "n2", name: "5V", endpoints: ["U1[3]", "C8[1]", "C9[1]", "R1[1]"] },
      { id: "n3", endpoints: ["R1[2]", "D1[A]"] },
      { id: "n4", name: "GND", endpoints: ["J1[2]", "U1[2]", ...caps.map((c) => `${c.id}[2]`), "C8[2]", "C9[2]", "D1[K]"] },
    ],
  };
}

function draw(circuit: Circuit) {
  const project: Project = { meta: { title: "regulator" }, circuit };
  const r = layout(project);
  expect(r.status, [...r.issues, ...r.notes].join(" | ")).toBe("valid");
  const el = r.render!.electrical;
  expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
  expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
  const pin = (part: string, n: string) => el.pins.find((p) => p.part === part && p.number === n)!;
  return { r, el, pin };
}

describe("regulator on the power path", () => {
  it("puts the output on the right with its capacitors in a row, smallest nearest", () => {
    const { r, el, pin } = draw(regulator(0));
    expect(pin("U1", "3").dir).toBe("right");
    expect(r.notes).toContain("power path: C9 beside U1[3]");
    expect(r.notes).toContain("power path: C8 beside U1[3]");
    const out = pin("U1", "3").at;
    // Both capacitors hang just below the output's row, to its right, the smaller one nearer.
    for (const c of ["C8", "C9"]) {
      expect(pin(c, "1").at[1]).toBe(out[1] + 1);
      expect(pin(c, "1").at[0]).toBeGreaterThan(out[0]);
    }
    expect(pin("C9", "1").at[0]).toBeLessThan(pin("C8", "1").at[0]);
    // The output pin is wired, with no symbol of its own; the row keeps one 5V symbol for the
    // outer capacitor, and the LED's resistor keeps its own.
    expect(el.wires.some((w) => w.some((p) => p[0] === out[0] && p[1] === out[1]))).toBe(true);
    expect(el.ports.some((p) => p.at[0] === out[0] && p.at[1] === out[1])).toBe(false);
    expect(el.ports.filter((p) => p.text === "5V")).toHaveLength(2);
  });

  it("puts an input with a load but no decoupling capacitor on the left, the load beside it", () => {
    const c = regulator(0);
    c.parts.push({ id: "R7", type: "resistor", props: { value: "100k" } });
    c.nets[0]!.endpoints.push("R7[1]");
    c.nets[3]!.endpoints.push("R7[2]");
    const { r, pin } = draw(c);
    expect(pin("U1", "1").dir).toBe("left");
    expect(r.notes).toContain("power path: R7 beside U1[1]");
    expect(pin("R7", "1").at[0]).toBeLessThan(pin("U1", "1").at[0]);
  });

  it("keeps the symbol on an input with no load at all", () => {
    const { el, pin } = draw(regulator(0));
    expect(pin("U1", "1").dir).toBe("up");
    expect(el.ports.some((p) => p.text === "VIN" && p.at[0] === pin("U1", "1").at[0])).toBe(true);
  });

  it("keeps an input's decoupling capacitors in its top slots", () => {
    const { r, pin } = draw(regulator(2));
    expect(pin("U1", "1").dir).toBe("up");
    expect(r.notes.some((n) => n.startsWith("decoupling") && n.includes("C1"))).toBe(true);
    expect(r.notes.some((n) => n.startsWith("power path: C1 ") || n.startsWith("power path: C2 "))).toBe(false);
    expect(pin("U1", "3").dir).toBe("right");
  });
});

describe("pathAnchors", () => {
  it("picks every capacitor to ground, smallest first, and only the outermost keeps a symbol", () => {
    const c = regulator(0);
    const drawnNet = new Map<string, string>();
    for (const n of c.nets) for (const e of n.endpoints) drawnNet.set(e, n.id);
    const got = pathAnchors([{ part: "U1", pin: "3" }], c, drawnNet, (n) => n === "n4", () => true);
    expect(got).toEqual([
      { part: "U1", pin: "3", load: "C9", loadPin: "1", symbol: false },
      { part: "U1", pin: "3", load: "C8", loadPin: "1", symbol: true },
    ]);
  });

  it("reads a capacitor's leading value, so a longer value keeps the row's order", () => {
    const c = regulator(0);
    c.parts.find((p) => p.id === "C9")!.props!.value = "100 nF X7R 50 V";
    const drawnNet = new Map<string, string>();
    for (const n of c.nets) for (const e of n.endpoints) drawnNet.set(e, n.id);
    expect(pathAnchors([{ part: "U1", pin: "3" }], c, drawnNet, (n) => n === "n4", () => true).map((a) => a.load)).toEqual(["C9", "C8"]);
  });

  it("takes one other two-pin load when there is no capacitor", () => {
    const c: Circuit = {
      parts: [reg, { id: "R2", type: "resistor", props: { value: "1k" } }, { id: "R1", type: "resistor", props: { value: "1k" } }],
      nets: [
        { id: "n2", name: "5V", endpoints: ["U1[3]", "R1[2]", "R2[1]"] },
        { id: "n4", name: "GND", endpoints: ["U1[2]", "R1[1]", "R2[2]"] },
      ],
    };
    const drawnNet = new Map<string, string>();
    for (const n of c.nets) for (const e of n.endpoints) drawnNet.set(e, n.id);
    expect(pathAnchors([{ part: "U1", pin: "3" }], c, drawnNet, (n) => n === "n4", () => true))
      .toEqual([{ part: "U1", pin: "3", load: "R1", loadPin: "2", symbol: true }]);
  });
});
