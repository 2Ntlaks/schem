import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LayoutState } from "../src/core/intent.js";
import { edit, type EditOp } from "../src/edit/edit.js";
import { changeReport, stabilityBreaks } from "../src/edit/report.js";
import type { Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";

interface Regression {
  seed: number;
  kind: string;
  originalBreaks: string[];
  project: Project;
  previous: LayoutState;
  ops: EditOp[];
}

const dir = join(import.meta.dirname, "fixtures", "edit-stability");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
  .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Regression);

describe("frozen edit-stability regressions (SPEC 15 gate 4)", () => {
  it("retains every failure from the original 150-seed probe", () => {
    expect(fixtures.map((f) => f.seed)).toEqual([31, 38, 60, 64, 76, 80, 83, 92, 97, 101, 107, 114, 133, 143]);
    for (const fixture of fixtures) expect(fixture.originalBreaks.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    it(`seed ${fixture.seed}: ${fixture.kind} is saved, valid and stable`, () => {
      const original = JSON.stringify(fixture);
      const r = edit(fixture);
      expect(r.saved, r.issues.join("\n")).toBe(true);
      expect(checkDrawing(r.project.circuit, r.layout!.pinDefs, r.layout!.render!).valid).toBe(true);
      // Recompute the gate from the frozen before-state, independently of the returned report.
      const report = changeReport(fixture.previous, r.layout!.state!, new Set(r.affected.parts),
        new Set(r.affected.nets), new Set((r.project.intent?.locks ?? []).map((l) => l.part)));
      expect(stabilityBreaks(report)).toEqual([]);
      expect(r.report).toEqual(report);
      expect(JSON.stringify(fixture)).toBe(original);
    });
  }
});
