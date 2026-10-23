import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LayoutState } from "../src/core/intent.js";
import { edit, layoutToken, revision, type EditOp } from "../src/edit/edit.js";
import { changeReport, stabilityBreaks } from "../src/edit/report.js";
import { layout, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";
import { BUILTIN } from "../src/symbols/library.js";

interface Regression {
  seed: number;
  kind: string;
  originalBreaks: string[];
  project: Project;
  previous: LayoutState;
  ops: EditOp[];
  affected: { parts: string[]; nets: string[] };
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
      const symbols = JSON.stringify(BUILTIN);
      const r = edit(fixture);
      expect(r.saved, r.issues.join("\n")).toBe(true);
      expect(r.affected).toEqual(fixture.affected);
      expect(checkDrawing(r.project.circuit, r.layout!.pinDefs, r.layout!.render!).valid).toBe(true);
      // Recompute the gate from the frozen before-state, independently of the returned report.
      const report = changeReport(fixture.previous, r.layout!.state!, new Set(fixture.affected.parts),
        new Set(fixture.affected.nets), new Set((r.project.intent?.locks ?? []).map((l) => l.part)));
      expect(stabilityBreaks(report)).toEqual([]);
      expect(r.report).toEqual(report);
      const repeated = edit(fixture);
      expect(repeated.layoutToken).toBe(r.layoutToken);
      expect(toSvg(repeated.layout!.render!)).toBe(toSvg(r.layout!.render!));
      const next = edit({ project: r.project, previous: r.layout!.state!, ops: [] });
      expect(next.saved, next.issues.join("\n")).toBe(true);
      expect(stabilityBreaks(next.report!)).toEqual([]);
      expect(next.layout!.state).toEqual(r.layout!.state);
      expect(JSON.stringify(fixture)).toBe(original);
      expect(JSON.stringify(BUILTIN)).toBe(symbols);
    });
  }
});

describe("stability enforcement", () => {
  const project = JSON.parse(readFileSync(join(import.meta.dirname, "..", "cases", "case05-i2c.json"), "utf8")) as Project;

  it("rejects a disruptive edit even when the canonical fallback is electrically valid", () => {
    const previous = layout(project).state!;
    const snapshot = JSON.stringify({ project, previous });
    const origin = previous.parts.R1!.at;
    const r = edit({ project, previous, ops: [{ op: "lock", part: "R1", at: [origin[0] + 20, origin[1]] }] });
    expect(r.saved).toBe(false);
    expect(r.status).toBe("budget_exhausted");
    expect(r.issues.join("\n")).toContain("canonical: stability gate failed");
    expect(r.issues.join("\n")).toContain("untouched parts moved");
    expect(r.project).toBe(project);
    expect(r.revision).toBe(revision(project));
    expect(r.layoutToken).toBe(layoutToken(project, previous));
    expect(JSON.stringify({ project, previous })).toBe(snapshot);
  });

  it("allows an explicit canonical relayout and spacing change to move the sheet", () => {
    const previous = layout(project).state!;
    for (const ops of [
      [{ op: "setSpacing", factor: 4 }],
      [{ op: "setSpacing", factor: 4 }, { op: "relayout", mode: "canonical" }],
    ] as EditOp[][]) {
      const r = edit({ project, previous, ops });
      expect(r.saved, r.issues.join("\n")).toBe(true);
      expect(r.mode).toBe("canonical");
      expect(r.check!.valid).toBe(true);
      expect(stabilityBreaks(r.report!).length).toBeGreaterThan(0);
    }
  });

  it("repairs a flipped pull-up locally instead of accepting a disruptive fallback", () => {
    const previous = layout(project).state!;
    const r = edit({ project, previous, ops: [{ op: "setOrientation", part: "R1", rot: 90, flip: true }] });
    expect(r.saved, r.issues.join("\n")).toBe(true);
    expect(r.mode).toBe("incremental");
    expect(stabilityBreaks(r.report!)).toEqual([]);
    expect(r.report!.untouched.maxMove).toBe(0);
  });

  it("does not round a failing mean displacement down to the acceptance threshold", () => {
    const before: LayoutState = { parts: {}, routes: {} };
    const after: LayoutState = { parts: {}, routes: {} };
    for (let i = 0; i < 100; i++) {
      const id = `R${i}`;
      before.parts[id] = { at: [i * 10, 0], orient: { rot: 0, flip: false } };
      after.parts[id] = { at: [i * 10 + (i < 50 ? 0 : 4), i === 99 ? 1 : 0], orient: { rot: 0, flip: false } };
    }
    const report = changeReport(before, after, new Set(), new Set(), new Set());
    expect(report.untouched.meanMove).toBeGreaterThan(2);
    expect(report.untouched.meanMove).toBeLessThan(2.005);
    expect(stabilityBreaks(report)).toHaveLength(1);
  });

  it("allows one unrelated reroute and rejects two", () => {
    const before: LayoutState = {
      parts: {},
      routes: {
        n1: { terminals: "A", runs: [[[0, 0], [2, 0]]] },
        n2: { terminals: "B", runs: [[[0, 3], [2, 3]]] },
      },
    };
    const after = structuredClone(before);
    after.routes.n1!.runs = [[[0, 1], [2, 1]]];
    const one = changeReport(before, after, new Set(), new Set(), new Set());
    expect(one.routesChanged.other).toEqual(["n1"]);
    expect(stabilityBreaks(one)).toEqual([]);
    after.routes.n2!.runs = [[[0, 4], [2, 4]]];
    const two = changeReport(before, after, new Set(), new Set(), new Set());
    expect(two.routesChanged.other).toEqual(["n1", "n2"]);
    expect(stabilityBreaks(two)).toEqual(["routes changed on 2 nets the edit did not involve (at most 1): n1, n2"]);
    expect(stabilityBreaks(changeReport(before, after, new Set(), new Set(["n1"]), new Set()))).toEqual([]);
  });
});
