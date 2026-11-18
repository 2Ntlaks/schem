import { join } from "node:path";
import { expect, it } from "vitest";
import { readProject } from "../src/io/project.js";
import { layout, type LayoutResult, type Project } from "../src/layout/layout.js";
import { toSvg } from "../src/render/svg.js";

const example = () => readProject(join(import.meta.dirname, "../bench/circuits/multivibrator.schem.json")).project!;
const hasAstable = (r: LayoutResult) => r.state?.templates?.some((key) => key.startsWith("npn-led-astable@")) ?? false;

function checkFeedback(project: Project) {
  const result = layout(project);
  expect(result.status).toBe("valid");
  expect(hasAstable(result)).toBe(true);
  const transistors = project.circuit.parts.filter((p) => p.type === "npn");
  const pins = result.render!.electrical.pins;
  const collectors = transistors.map((q) => pins.find((p) => p.part === q.id && p.number === "C")!)
    .sort((a, b) => a.at[0] - b.at[0]);
  const [left, right] = collectors;
  expect(left!.at[1]).toBe(right!.at[1]);
  for (const [index, collector] of collectors.entries()) {
    const base = pins.find((p) => p.part === collector.part && p.number === "B")!;
    expect(base.dir).toBe(index === 0 ? "right" : "left");
  }
  const caps = project.circuit.parts.filter((p) => p.type === "capacitor");
  const feedback = project.circuit.nets.filter((n) => caps.some((c) => n.endpoints.some((e) => e.startsWith(c.id + "["))));
  expect(feedback).toHaveLength(4);
  for (const n of feedback) {
    const runs = result.state!.routes[n.id]!.runs;
    expect(runs.length).toBeGreaterThan(0);
    for (const [x] of runs.flat()) {
      expect(x).toBeGreaterThanOrEqual(left!.at[0]);
      expect(x).toBeLessThanOrEqual(right!.at[0]);
    }
  }
  return toSvg(result.render!);
}

it("keeps both timing paths inside the legs after reordering and renaming", () => {
  const project = example();
  const svg = checkFeedback(project);
  const { parts, nets } = project.circuit;
  parts.reverse();
  nets.reverse();
  for (const n of nets) n.endpoints.reverse();
  expect(checkFeedback(project)).toBe(svg);

  const names = new Map(parts.map((p, i) => [p.id, "X" + (100 + i)]));
  for (const p of parts) p.id = names.get(p.id)!;
  for (const [i, n] of nets.entries()) {
    n.id = "wire" + i;
    n.endpoints = n.endpoints.map((e) => e.replace(/^[^\[]+/, (part) => names.get(part)!));
  }
  checkFeedback(project);
});

it.each(["missing", "same-side"])("leaves %s feedback to the other layout rules", (variant) => {
  const project = example(), circuit = project.circuit;
  if (variant === "missing") {
    circuit.parts = circuit.parts.filter((p) => p.id !== "C1");
    for (const n of circuit.nets) n.endpoints = n.endpoints.filter((e) => !e.startsWith("C1["));
  } else {
    // Same parts and pin counts, but each capacitor now feeds its own transistor.
    for (const n of circuit.nets) n.endpoints = n.endpoints.map((e) => e === "C1[2]" ? "C2[2]" : e === "C2[2]" ? "C1[2]" : e);
  }
  const result = layout(project);
  expect(result.status).toBe("valid");
  expect(hasAstable(result)).toBe(false);
});
