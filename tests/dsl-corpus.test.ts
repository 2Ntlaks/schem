import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileDsl } from "../src/core/dsl.js";
import { formatDsl } from "../src/core/dsl-format.js";
import { loadProject, type LoadedProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";

const text = (url: URL) => readFileSync(url, "utf8");
const path = (file: string) => new URL(file, import.meta.url);

function checkedSvg(project: LoadedProject): string {
  const drawn = layout(project);
  expect(drawn.status, drawn.issues.join("\n")).toBe("valid");
  expect(checkDrawing(project.circuit, drawn.pinDefs, drawn.render!).valid).toBe(true);
  return toSvg(drawn.render!);
}

function alternate(source: string): string {
  const lines = source.split("\n").filter(Boolean);
  const hints = lines.filter((line) => line.startsWith("hint "));
  // Hints are explicitly ordered in SPEC 6.4. Reorder the unordered declarations.
  const unordered = lines.filter((line) => !line.startsWith("hint ")).reverse();
  return "# Variant\n\n" + [...unordered, ...hints].map((line) => `${line} # comment\n\n`).join("");
}

describe.each([
  { group: "validation", originals: "../phase0/cases/validation/", suffix: ".json" },
  { group: "bench", originals: "../bench/circuits/", suffix: ".schem.json" },
])("$group text circuit corpus", ({ group, originals, suffix }) => {
  const corpus = path(`./dsl-corpus/${group}/`);
  it.each(readdirSync(corpus).filter((file) => file.endsWith(".schem")).sort())("%s draws byte-identical SVG", (file) => {
    const original = loadProject(text(path(`${originals}${file.slice(0, -6)}${suffix}`)));
    const source = text(new URL(file, corpus)).replaceAll("\r\n", "\n");
    const compiled = compileDsl(source), variant = compileDsl(alternate(source));
    expect(original.errors).toEqual([]);
    expect(compiled.errors).toEqual([]);
    expect(variant.errors).toEqual([]);
    expect(formatDsl(original.project!)).toEqual({ ok: true, source });
    const expected = checkedSvg(original.project!);
    expect(checkedSvg(compiled.project!)).toBe(expected);
    expect(checkedSvg(variant.project!)).toBe(expected);
    expect(variant.project!.circuit.nets).toEqual(compiled.project!.circuit.nets);
  });
});

it("named pins, aliases and numbered pins draw the same LED circuit", () => {
  const source = text(path("./dsl-corpus/validation/case01-led.schem"));
  const expected = checkedSvg(compileDsl(source).project!);
  const choices = [
    ["D1.anode", "D1.cathode", "B1.+", "B1.-", "R1.1", "R1.2"],
    ["D1.a", "D1.k", "B1.pos", "B1.neg", "R1.1", "R1.2"],
  ];
  const canonical = ["D1[A]", "D1[K]", "B1[+]", "B1[-]", "R1[1]", "R1[2]"];
  for (const pins of choices) {
    const variant = canonical.reduce((text, endpoint, i) => text.replaceAll(endpoint, pins[i]!), source);
    const compiled = compileDsl(variant);
    expect(compiled.errors).toEqual([]);
    expect(checkedSvg(compiled.project!)).toBe(expected);
  }
});
