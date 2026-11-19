// Bridges (src/layout/bridges.ts): a two-pin part across two pins of one chip stands beside them.

import { describe, expect, it } from "vitest";
import type { Circuit } from "../src/core/model.js";
import { validate } from "../src/core/validate.js";
import { layout, pinDefsOf, type Project } from "../src/layout/layout.js";
import { findBridges } from "../src/layout/bridges.js";
import { BUILTIN, HEADER } from "../src/symbols/library.js";
import { toSvg } from "../src/render/svg.js";
import { verify } from "../src/verify/verify.js";

const crystal = (bridgeType = "crystal"): Circuit => ({
  parts: [
    { id: "U1", type: "ic", props: { label: "MCU", controller: "true" }, pins: [
      { number: "1", name: "XTAL1", role: "input" },
      { number: "2", name: "XTAL2", role: "output" },
      { number: "3", name: "GND", role: "ground" },
    ] },
    { id: "Y1", type: bridgeType, props: { value: "16MHz" } },
    { id: "C1", type: "capacitor", props: { value: "22p" } },
    { id: "C2", type: "capacitor", props: { value: "22p" } },
  ],
  nets: [
    { id: "n1", name: "XTAL1", endpoints: ["U1[1]", "Y1[1]", "C1[1]"] },
    { id: "n2", name: "XTAL2", endpoints: ["U1[2]", "Y1[2]", "C2[1]"] },
    { id: "n3", name: "GND", endpoints: ["U1[3]", "C1[2]", "C2[2]"] },
  ],
});

function draw(circuit: Circuit) {
  const project: Project = { meta: { title: "bridge" }, circuit };
  const r = layout(project);
  expect(r.status, [...r.issues, ...r.notes].join(" | ")).toBe("valid");
  const el = r.render!.electrical;
  expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
  expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
  const at = (part: string, n: string) => el.pins.find((p) => p.part === part && p.number === n)!.at;
  return { r, at };
}

function bridgesOf(circuit: Circuit) {
  const defs = pinDefsOf(circuit);
  const v = validate(circuit, defs).valid!;
  const drawnNet = new Map<string, string>();
  for (const [net, eps] of v.endpoints) for (const ep of eps) if (ep.kind === "terminal") drawnNet.set(`${ep.part}[${ep.number}]`, net);
  const portNet = new Set(circuit.nets.filter((n) => n.name === "GND" || n.name === "VCC").map((n) => n.id));
  const type = new Map(circuit.parts.map((p) => [p.id, p.type]));
  return findBridges({ parts: circuit.parts, defs, drawnNet, portNet, free: () => true,
    box: (id) => !BUILTIN[type.get(id)!] && type.get(id) !== HEADER, fixedOrient: () => undefined });
}

describe("bridges", () => {
  it("finds a crystal across two pins of a chip, pin 1 on top", () => {
    expect(bridgesOf(crystal())).toEqual([{ part: "Y1", host: "U1", hostPins: ["1", "2"], partPins: ["1", "2"] }]);
  });

  it("ignores a part with a pin on a supply or ground symbol", () => {
    const c = crystal();
    c.nets[0]!.name = "VCC";
    expect(bridgesOf(c)).toEqual([]);
  });

  it("ignores a part across two chips", () => {
    const c = crystal();
    c.parts.push({ id: "U2", type: "ic", pins: [{ number: "1", name: "A", role: "input" }] });
    c.nets[1]!.endpoints = ["U2[1]", "Y1[2]", "C2[1]"];
    expect(bridgesOf(c)).toEqual([]);
  });

  it("stands a crystal between the clock pins, with no hint", () => {
    const { r, at } = draw(crystal());
    expect(r.notes).toContain("bridge: Y1 beside U1[1] and U1[2]");
    // The two clock pins sit next to each other on one side.
    expect(at("U1", "1")[0]).toBe(at("U1", "2")[0]);
    expect(at("U1", "2")[1] - at("U1", "1")[1]).toBe(2);
    // The crystal stands up, pin 1 on top, beside them and starting at the upper pin.
    expect(at("Y1", "1")[0]).toBe(at("Y1", "2")[0]);
    expect(at("Y1", "1")[1]).toBe(at("U1", "1")[1] + 1);
    expect(at("Y1", "2")[1]).toBeGreaterThan(at("U1", "2")[1]);
    const side = Math.sign(at("Y1", "1")[0] - at("U1", "1")[0]);
    expect(side).not.toBe(0);
    expect(Math.abs(at("Y1", "1")[0] - at("U1", "1")[0])).toBeLessThanOrEqual(6);
  });

  it("does the same for a resistor across two pins of a chip", () => {
    const { r } = draw(crystal("resistor"));
    expect(r.notes).toContain("bridge: Y1 beside U1[1] and U1[2]");
  });
});
