import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";

const benchProject = (name: string) => readProject(
  join(import.meta.dirname, "..", "bench", "circuits", `${name}.schem.json`),
).project!;

describe("voltage divider with a split tap", () => {
  it.each([
    { circuit: "ce-amp", upper: "R1", lower: "R2" },
    { circuit: "follower", upper: "R1", lower: "R2" },
    { circuit: "mixer-ce", upper: "R4", lower: "R5" },
  ])("$circuit routes the coupling capacitor straight to the base", ({ circuit, upper, lower }) => {
    const project = benchProject(circuit);
    const result = layout(project);
    expect(result.status).toBe("valid");
    expect(checkDrawing(project.circuit, result.pinDefs, result.render!).valid).toBe(true);

    const { pins, wires, dots } = result.render!.electrical;
    const pin = (part: string, number: string) => pins.find((p) => p.part === part && p.number === number)!.at;
    const input = pin("C1", "2");
    const base = pin("Q1", "B");
    const upperTap = pin(upper, "2");
    const lowerTap = pin(lower, "1");
    const y = base[1];
    expect(lowerTap[0] - upperTap[0]).toBe(2);
    expect(wires).toEqual(expect.arrayContaining([
      [input, base],
      [upperTap, [upperTap[0], y]],
      [[lowerTap[0], y], lowerTap],
    ]));
    expect(dots.filter(([x, row]) => row === y && input[0] < x && x < base[0]))
      .toEqual([[upperTap[0], y], [lowerTap[0], y]]);
  });

  it("redraws a saved divider with its original geometry", () => {
    const project = benchProject("ce-amp");
    const saved = layout(project, { templates: { skip: ["voltage-divider-split-tap@1:R1,R2"] } });
    const redrawn = layout(project, { previous: saved.state, affected: [] });
    expect(redrawn.status).toBe("valid");
    expect(toSvg(redrawn.render!)).toBe(toSvg(saved.render!));
  });
});
