// A battery and the fuse or switch on its way to a supply symbol stand in one vertical line
// (src/layout/stacks.ts), and that block feeds the supply in the flow (src/layout/flow.ts).

import { describe, expect, it } from "vitest";
import type { Circuit } from "../src/core/model.js";
import { layout, type Project } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";
import { verify } from "../src/verify/verify.js";

/** B1 through `series` up to VBAT, which feeds a capacitor and a resistor with an LED. */
function supply(series: string, sourceToGround = true): Circuit {
  return {
    parts: [
      { id: "B1", type: "battery", props: { value: "9V" } },
      { id: "S1", type: series },
      { id: "R1", type: "resistor", props: { value: "1k" } },
      { id: "D1", type: "led", props: { color: "red" } },
      { id: "C1", type: "capacitor", props: { value: "100u" } },
      ...(sourceToGround ? [] : [{ id: "R9", type: "resistor", props: { value: "10" } }]),
    ],
    nets: [
      { id: "n1", endpoints: ["B1[+]", "S1[1]"] },
      { id: "n2", name: "VBAT", endpoints: ["S1[2]", "R1[1]", "C1[1]"] },
      { id: "n3", endpoints: ["R1[2]", "D1[A]"] },
      ...(sourceToGround
        ? [{ id: "n4", name: "GND", endpoints: ["B1[-]", "D1[K]", "C1[2]"] }]
        : [{ id: "n4", name: "GND", endpoints: ["R9[2]", "D1[K]", "C1[2]"] }, { id: "n5", endpoints: ["B1[-]", "R9[1]"] }]),
    ],
  };
}

function draw(circuit: Circuit) {
  const project: Project = { meta: { title: "supply" }, circuit };
  const r = layout(project);
  expect(r.status, [...r.issues, ...r.notes].join(" | ")).toBe("valid");
  const el = r.render!.electrical;
  expect(verify(circuit, r.pinDefs, el).errors).toEqual([]);
  expect(toSvg(layout(project).render!)).toBe(toSvg(r.render!));
  const pin = (part: string, n: string) => el.pins.find((p) => p.part === part && p.number === n)!;
  return { r, pin };
}

describe("supply string", () => {
  for (const series of ["spst", "fuse"]) {
    it(`stands a battery under its ${series}, + up, in one line with the supply symbol`, () => {
      const { r, pin } = draw(supply(series));
      expect(r.notes.some((n) => n.startsWith("stack: B1 below S1["))).toBe(true);
      // One vertical line: the series part's lower pin straight above the battery's + pin.
      expect(pin("B1", "+").dir).toBe("up");
      expect(pin("B1", "+").at[0]).toBe(pin("S1", "1").at[0]);
      expect(pin("B1", "+").at[1]).toBeGreaterThan(pin("S1", "1").at[1]);
      // The block feeds VBAT, so what VBAT feeds comes after it.
      expect(pin("R1", "1").at[0]).toBeGreaterThan(pin("S1", "2").at[0]);
    });
  }

  it("leaves a battery alone when its other pin does not go straight to ground", () => {
    const { r } = draw(supply("spst", false));
    expect(r.notes.some((n) => n.startsWith("stack: B1 "))).toBe(false);
  });
});
