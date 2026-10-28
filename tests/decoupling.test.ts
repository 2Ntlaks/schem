import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProject } from "../src/io/project.js";
import { layout, type Project } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { manhattan } from "../src/geom/geom.js";
import { toSvg } from "../src/render/svg.js";
import { edit } from "../src/edit/edit.js";
import { stabilityBreaks } from "../src/edit/report.js";
import { readEditScript, applyEditScript } from "../src/io/edit-script.js";
import { verify } from "../src/verify/verify.js";

const root = join(import.meta.dirname, "..");
const fixture = join(root, "phase0/cases/validation/case07-two-ic-decoupling.json");
const project = (): Project => {
  const loaded = readProject(fixture);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
  return loaded.project!;
};

describe("decoupling child slots", () => {
  it("places each hinted capacitor within 8 G of its specified pin and preserves topology", () => {
    const p = project(), before = JSON.stringify(p.circuit);
    const r = layout(p);
    expect(r.status).toBe("valid");
    const q = checkDrawing(p.circuit, r.pinDefs, r.render!);
    expect(q.valid).toBe(true);
    expect(q.conventions).toEqual([]);
    expect(JSON.stringify(p.circuit)).toBe(before);
    for (const h of p.intent!.hints!) {
      if (h.type !== "decouples") continue;
      const pin = r.render!.electrical.pins.find((p) => `${p.part}[${p.number}]` === h.pin)!;
      const supply = r.render!.electrical.pins.find((p) => p.part === h.part && p.dir === "up")!;
      expect(manhattan(pin.at, supply.at), h.id).toBeLessThanOrEqual(8);
      // Supply pins use explicit short wires, rather than disconnected equal-name ports.
      expect(r.render!.electrical.ports.some((p) => p.at[0] === supply.at[0] && p.at[1] === supply.at[1])).toBe(false);
      const wire = r.render!.electrical.wires.find((w) => w.some((a) => a[0] === supply.at[0] && a[1] === supply.at[1]))!;
      expect(wire).toBeDefined();
      expect(verify(p.circuit, r.pinDefs, { ...r.render!.electrical, wires: r.render!.electrical.wires.filter((w) => w !== wire) }).valid).toBe(false);
    }
  });

  it("is deterministic when parts, nets, endpoints and hints are reordered", () => {
    const p = project(), a = toSvg(layout(p).render!);
    p.circuit.parts.reverse(); p.circuit.nets.reverse();
    for (const n of p.circuit.nets) n.endpoints.reverse();
    p.intent!.hints!.reverse();
    expect(toSvg(layout(p).render!)).toBe(a);
  });

  it("keeps a no-op edit byte-identical", () => {
    const p = project(), before = layout(p);
    const r = edit({ project: p, previous: before.state, ops: [] });
    expect(r.saved, r.issues.join("; ")).toBe(true);
    expect(toSvg(r.layout!.render!)).toBe(toSvg(before.render!));
  });

  it("orders different capacitances consistently within a shared pin's slot", () => {
    const p = project();
    p.circuit.parts.find((p) => p.id === "C3")!.props!.value = "22u";
    p.circuit.parts.find((p) => p.id === "C4")!.props!.value = "100n";
    const r = layout(p);
    expect(r.status).toBe("valid");
    const pin = (id: string) => r.render!.electrical.pins.find((p) => p.part === id && p.dir === "up")!;
    expect(manhattan(pin("C4").at, pin("U2").at)).toBeLessThanOrEqual(manhattan(pin("C3").at, pin("U2").at));
    expect(r.state!.parts.C4!.at[0]).toBeLessThan(r.state!.parts.C3!.at[0]);
  });

  it("keeps all four frozen validation edits valid and stable", () => {
    const p = readProject(fixture);
    if (!p.ok) throw new Error("fixture did not load");
    const before = layout(p.project!);
    for (const kind of ["longer-value", "add-part", "remove-part", "pin-sides"]) {
      const script = readEditScript(join(root, `phase0/cases/edits/case07-${kind}.json`));
      if (!script.ok) throw new Error("script did not load");
      const run = applyEditScript(p.project!, script.script, before.state);
      expect(run.result.saved, kind).toBe(true);
      expect(run.result.check!.valid, kind).toBe(true);
      expect(run.stability!.breaks, kind).toEqual([]);
    }
  });

  it("respects locking an existing capacitor without displacing it", () => {
    const p = project(), before = layout(p);
    const r = edit({ project: p, previous: before.state, ops: [{ op: "lock", part: "C3" }] });
    expect(r.saved, r.issues.join("; ")).toBe(true);
    expect(r.layout!.state!.parts.C3).toEqual(before.state!.parts.C3);
    expect(r.check!.valid).toBe(true);
    expect(stabilityBreaks(r.report!)).toEqual([]);
  });

  it("does not attach a capacitor to an unrelated power pin named by a bad hint", () => {
    const p = project();
    const hint = p.intent!.hints!.find((h) => h.type === "decouples" && h.part === "C1")!;
    if (hint.type !== "decouples") throw new Error("missing hint");
    hint.pin = "U1[1]"; // RESET, not the capacitor's supply net.
    const r = layout(p);
    expect(r.status.startsWith("valid")).toBe(true);
    expect(r.notes.some((n) => n.startsWith("decoupling@1: C1 "))).toBe(false);
    expect(checkDrawing(p.circuit, r.pinDefs, r.render!).valid).toBe(true);
  });

  it("resolves hint aliases and refuses to guess between ICs when hints are absent", () => {
    const p = project();
    for (const h of p.intent!.hints!) if (h.type === "decouples") {
      h.pin = h.part === "C1" ? "U1.VCC" : h.part === "C2" ? "U1.AVCC" : "U2.VCC";
    }
    expect(layout(p).notes.filter((n) => n.startsWith("decoupling@1:")).length).toBe(4);
    p.intent!.hints = [];
    const r = layout(p);
    expect(r.notes.some((n) => n.startsWith("decoupling@1:"))).toBe(false);
    expect(checkDrawing(p.circuit, r.pinDefs, r.render!).valid).toBe(true);
  });

  it("keeps an explicit orientation edit valid without enforcing a conflicting slot", () => {
    const p = project(), before = layout(p);
    const r = edit({ project: p, previous: before.state, ops: [{ op: "setOrientation", part: "C1", rot: 270 }] });
    expect(r.saved, r.issues.join("; ")).toBe(true);
    expect(r.layout!.state!.parts.C1!.orient.rot).toBe(270);
    expect(r.check!.valid).toBe(true);
  });
});
