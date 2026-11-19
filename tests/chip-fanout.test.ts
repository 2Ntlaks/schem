import { join } from "node:path";
import { expect, it } from "vitest";
import { edit } from "../src/edit/edit.js";
import { readProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";

const examples = [
  { name: "shift", chip: "U2", branches: [["15", "R1"], ["1", "R2"], ["2", "R3"], ["3", "R4"]] },
  { name: "mcu", chip: "U1", branches: [["19", "R2"], ["15", "R3"]] },
] as const;

for (const { name, chip, branches } of examples) {
  it(`${name}: overlapping output branches stagger and take one bend each`, () => {
    const file = join(import.meta.dirname, "..", "bench", "circuits", `${name}.schem.json`);
    const project = readProject(file).project!;
    const result = layout(project);
    expect(result.status, result.issues.join(", ")).toBe("valid");
    const pin = (part: string, number: string) => result.render!.electrical.pins
      .find((p) => p.part === part && p.number === number)!;

    const ordered = branches.map(([number, resistor]) => {
      const source = pin(chip, number), target = pin(resistor, "1");
      const net = project.circuit.nets.find((n) => n.endpoints.includes(`${chip}[${number}]`))!;
      const corner = [target.at[0], source.at[1]];
      const runs = result.state!.routes[net.id]!.runs;
      expect(source.dir).toBe("right");
      expect(target.dir).toBe("up");
      expect(runs).toHaveLength(2);
      expect(runs).toEqual(expect.arrayContaining([[source.at, corner], [corner, target.at]]));
      return { row: source.at[1], column: target.at[0] };
    }).sort((a, b) => a.row - b.row);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.column).toBeLessThan(ordered[i - 1]!.column);
    }

    const svg = toSvg(result.render!);
    project.circuit.parts.reverse();
    project.circuit.nets.reverse();
    for (const net of project.circuit.nets) net.endpoints.reverse();
    expect(toSvg(layout(project).render!)).toBe(svg);

    const edited = edit({ project, previous: result.state, ops: [] });
    expect(edited.saved, edited.issues.join(", ")).toBe(true);
    expect(toSvg(edited.layout!.render!)).toBe(svg);
  });
}

it("keeps an explicitly oriented branch out of staggered placement", () => {
  const file = join(import.meta.dirname, "..", "bench", "circuits", "mcu.schem.json");
  const project = readProject(file).project!;
  project.intent = {
    hints: [{ id: "led-resistor", type: "orient", part: "R2", priority: "strict", rot: 90, flip: false }],
  };

  const result = layout(project);
  expect(result.status, result.issues.join(", ")).toBe("valid");
  expect(result.state!.parts.R2!.orient).toEqual({ rot: 90, flip: false });
  expect(result.state!.parts.R2!.column).toBe(result.state!.parts.R3!.column);
});
