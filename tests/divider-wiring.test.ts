import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";

describe("voltage divider with a split tap", () => {
  it.each([
    { circuit: "ce-amp", upper: "R1", lower: "R2" },
    { circuit: "follower", upper: "R1", lower: "R2" },
    { circuit: "mixer-ce", upper: "R4", lower: "R5" },
  ])("$circuit routes the coupling capacitor straight to the base", ({ circuit, upper, lower }) => {
    const path = join(import.meta.dirname, "..", "bench", "circuits", `${circuit}.schem.json`);
    const project = readProject(path).project!;
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
});
