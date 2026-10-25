// Project files (SPEC 6.5, 6.6), modules (SPEC 7.3), decouples hints (SPEC 6.4) and edit scripts
// (SPEC 11.3). Reads the frozen validation cases and edit scripts in phase0/ (never phase0/cases/test/).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { circuitEquals } from "../src/core/equals.js";
import { checkHints, type Hint } from "../src/core/intent.js";
import { classOf, groupRepresentative, resolveEndpoint } from "../src/core/validate.js";
import { revision } from "../src/edit/edit.js";
import { applyEditScript, parseEditScript, readEditScript, type EditScript } from "../src/io/edit-script.js";
import { loadProject, projectDocument, projectPinDefs, readProject, saveProject, SCHEMA, type LoadedProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { xformDir, xformPt } from "../src/geom/geom.js";
import { BUILTIN } from "../src/symbols/library.js";
import { checkModuleDef, MODULE_LIBRARY, moduleFile } from "../src/modules/index.js";

const ROOT = join(import.meta.dirname, "..");
const VALIDATION = join(ROOT, "phase0", "cases", "validation");
const EDITS = join(ROOT, "phase0", "cases", "edits");
const text = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(text(p));

function loaded(input: unknown): LoadedProject {
  const r = loadProject(input);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  expect(r.ok).toBe(true);
  return r.project!;
}

/** A small SPEC 6.5 project around a module, built here (independent of the case corpus). */
function moduleProject(): Record<string, unknown> {
  return {
    schema: "schem/1.0",
    meta: { title: "module test", nextNetId: 4, nextHintId: 1 },
    circuit: {
      parts: [
        { id: "U1", type: "module:esp32-devkitc-v4" },
        { id: "R1", type: "resistor", props: { value: "1k" } },
        { id: "D1", type: "led", props: { color: "green" } },
      ],
      nets: [
        { id: "n1", name: "LED", endpoints: ["U1.GPIO26", "R1[1]"] },
        { id: "n2", endpoints: ["R1[2]", "D1[A]"] },
        { id: "n3", name: "GND", endpoints: ["U1.GND", "D1[K]"] },
      ],
      nc: [],
    },
    intent: { hints: [], locks: [], overrides: {}, style: { theme: "clean", symbols: "ieee" } },
    assets: { library: "schem-symbols@test", definitions: {} },
    ext: { note: { "R1": "ext keys that look like part ids are never rewritten" }, list: [1, "two", { three: 3 }], "unicode Ω µ": "4.7 kΩ" },
  };
}

// ---------------------------------------------------------------------------

describe("project files: both shapes", () => {
  it("reads the Phase 0a shape (meta + circuit, endpoints by name) and upgrades it on save", () => {
    for (const f of ["case01-led.json", "case03-summing.json", "case05-i2c.json"]) {
      const raw = json(join(VALIDATION, f));
      const p = loaded(raw);
      expect(p.shape).toBe("phase0a");
      expect(p.circuit).toEqual(raw.circuit);
      const saved = saveProject(p);
      const doc = JSON.parse(saved);
      expect(Object.keys(doc)).toEqual(["schema", "meta", "circuit", "intent", "assets", "ext"]);
      expect(doc.schema).toBe(SCHEMA);
      for (const n of doc.circuit.nets) for (const e of n.endpoints) expect(e).toMatch(/^[A-Za-z][A-Za-z0-9_]*[[{]/);
      const again = loaded(saved);
      expect(again.shape).toBe("schem");
      expect(circuitEquals(p.circuit, projectPinDefs(p), again.circuit, projectPinDefs(again))).toBe(true);
      expect(saveProject(again)).toBe(saved); // canonical form is a fixed point
    }
  });

  it("round-trips SPEC 6.5 files byte for byte (canonical form, ext kept)", () => {
    for (const f of ["case02-divider-buffer.json", "case07-two-ic-decoupling.json"]) {
      const t = text(join(VALIDATION, f));
      const p = loaded(t);
      expect(p.shape).toBe("schem");
      expect(p.ext).toEqual(JSON.parse(t).ext);
      expect(saveProject(p)).toBe(t);
    }
  });

  it("the Phase 0a case and its drawing are the same whether read by the loader or as raw JSON", () => {
    const raw = json(join(VALIDATION, "case03-summing.json"));
    const a = layout(raw), b = layout(loaded(raw));
    expect(b.status).toBe(a.status);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it("keeps ext exactly and never interprets it, through edits and saves", () => {
    const doc = moduleProject();
    const p = loaded(doc);
    expect(p.ext).toEqual(doc.ext);
    const run = applyEditScript(p, { ops: [{ op: "renamePart", from: "R1", to: "R9" }, { op: "setProp", part: "R9", key: "value", value: "2k2" }] });
    expect(run.result.saved, run.result.issues.join("; ")).toBe(true);
    expect(run.project!.ext).toEqual(doc.ext);
    const out = JSON.parse(saveProject(run.project!));
    expect(out.ext).toEqual(doc.ext);
    expect(Object.keys(out.ext)).toEqual(Object.keys(doc.ext as object));
  });

  it("refuses a newer schema major, and malformed schemas", () => {
    const base = moduleProject();
    expect(loadProject({ ...base, schema: "schem/2.0" }).errors[0]!.code).toBe("E101");
    expect(loadProject({ ...base, schema: "schem/1" }).errors[0]!.code).toBe("E101");
    expect(loadProject({ ...base, schema: "schem/1.7" }).ok).toBe(true); // minor versions only add optional fields
    expect(loadProject("{ not json").errors[0]!.code).toBe("E100");
    expect(loadProject({ meta: {} }).errors[0]!.code).toBe("E102");
  });

  it("an unknown field outside ext: renders, but edits and saves are refused (SPEC 6.6)", () => {
    const doc = moduleProject() as any;
    doc.circuit.parts[1].tolerance = "1%";
    doc.future = { x: 1 };
    const r = loadProject(doc);
    expect(r.ok).toBe(true);
    expect(r.project!.unknownFields).toEqual(["future", "circuit.parts[R1].tolerance"]);
    expect(r.warnings.map((w) => w.code)).toContain("W105");
    expect(layout(r.project!).status.startsWith("valid")).toBe(true);
    const run = applyEditScript(r.project!, { ops: [{ op: "setProp", part: "R1", key: "value", value: "2k" }] });
    expect(run.result.saved).toBe(false);
    expect(run.result.issues[0]).toMatch(/^E105 .*circuit\.parts\[R1\]\.tolerance/);
    expect(() => saveProject(r.project!)).toThrow(/does not know/);
  });

  it("reports unknown part types as missing (not a crash) and still checks the rest", () => {
    const doc = moduleProject() as any;
    doc.circuit.parts.push({ id: "Q1", type: "npn-made-up" }, { id: "Q2", type: "npn-made-up" }, { id: "K1", type: "relay-made-up" });
    const r = loadProject(doc);
    expect(r.ok).toBe(false);
    expect(r.missingTypes).toEqual(["npn-made-up", "relay-made-up"]);
    expect(r.errors.filter((e) => e.code === "E201")).toHaveLength(3);
  });

  it("parts with their own pins: ic and other types (header) load; fixed symbols and modules may not carry pins", () => {
    const doc = moduleProject() as any;
    doc.circuit.parts.push({ id: "J1", type: "header", pins: [{ number: "1", name: "SIG" }, { number: "2", name: "GND" }] });
    const r = loadProject(doc);
    expect(r.ok).toBe(true);
    expect(r.pinDefs!.J1!.map((p) => p.role)).toEqual(["passive", "ground"]); // header: passive unless the name says supply or ground
    doc.circuit.parts.push({ id: "X1", type: "my-custom-board", pins: [{ number: "1", name: "SIG" }, { number: "2", name: "VCC" }] });
    expect(loadProject(doc).pinDefs!.X1!.map((p) => p.role)).toEqual(["bidir", "power_in"]); // SPEC 7.3 defaults for other own-pin parts
    expect(projectDocument(r.project!).circuit).toMatchObject({ parts: expect.arrayContaining([{ id: "J1", type: "header", pins: [{ number: "1", name: "SIG" }, { number: "2", name: "GND" }] }]) });
    const fixed = moduleProject() as any;
    fixed.circuit.parts[1].pins = [{ number: "1", name: "1" }];
    expect(loadProject(fixed).errors.map((e) => e.code)).toContain("E203");
    const mod = moduleProject() as any;
    mod.circuit.parts[0].pins = [{ number: "1", name: "X" }];
    expect(loadProject(mod).errors.map((e) => e.code)).toContain("E203");
    const ic = moduleProject() as any;
    ic.circuit.parts.push({ id: "U9", type: "ic" });
    expect(loadProject(ic).errors.map((e) => e.code)).toContain("E203");
  });

  it("checks circuit invariants on load (SPEC 6.3: loading never merges)", () => {
    const doc = moduleProject() as any;
    doc.circuit.nets[1].endpoints.push("U1[J2-14]"); // a member of group GND, which is in n3
    expect(loadProject(doc).errors.map((e) => e.code)).toContain("E222");
  });
});

// ---------------------------------------------------------------------------

describe("modules (SPEC 7.3)", () => {
  it("ships the four corpus modules, byte-identical to phase0/modules", () => {
    expect(Object.keys(MODULE_LIBRARY)).toEqual(["module:arduino-uno-r3", "module:esp32-devkitc-v4", "module:pololu-d24v10f5", "module:waveshare-lcd1602-i2c"]);
    for (const id of Object.keys(MODULE_LIBRARY)) {
      const f = moduleFile(id)!;
      expect(text(join(ROOT, "src", "modules", f))).toBe(text(join(ROOT, "phase0", "modules", f)));
      expect(checkModuleDef(MODULE_LIBRARY[id], id)).toEqual([]);
    }
  });

  it("resolves a module part to inline pins with numbers, names, aliases, groups, roles and the controller flag", () => {
    const p = loaded(moduleProject());
    const u1 = p.circuit.parts.find((x) => x.id === "U1")!;
    expect(u1.pins).toEqual(MODULE_LIBRARY["module:esp32-devkitc-v4"]!.pins);
    expect(u1.props).toEqual({ controller: "true" });
    const defs = projectPinDefs(p);
    const ep = (t: string) => { const r = resolveEndpoint(t, defs); return r.ok ? r.ep : r.issue.code; };
    expect(ep("U1.GPIO26")).toEqual({ kind: "terminal", part: "U1", number: "J2-10" }); // alias
    expect(ep("U1.DAC_2")).toEqual({ kind: "terminal", part: "U1", number: "J2-10" }); // second alias
    expect(ep("U1.IO26")).toEqual({ kind: "terminal", part: "U1", number: "J2-10" }); // name
    expect(ep("U1.GND")).toEqual({ kind: "group", part: "U1", group: "GND" }); // three GND pins, one group
    expect(ep("U1{GND}")).toEqual({ kind: "group", part: "U1", group: "GND" });
    expect(ep("U1[J3-7]")).toEqual({ kind: "terminal", part: "U1", number: "J3-7" });
    expect(ep("U1.NOPE")).toBe("E104");
    // SPEC 6.2: the representative is the lowest-numbered member in natural order.
    expect(groupRepresentative("U1", "GND", defs)).toBe("J2-14");
    expect(groupRepresentative("U1", "GND", defs, new Set(["U1[J2-14]"]))).toBe("J3-1");
    expect(defs.U1!.find((x) => x.number === "J2-1")).toMatchObject({ name: "3V3", role: "power_out" });
  });

  it("Arduino Uno: groups across headers, ambiguous names need numbers (E106), natural-order representative", () => {
    const doc = moduleProject() as any;
    doc.circuit.parts[0] = { id: "A1", type: "module:arduino-uno-r3" };
    doc.circuit.nets[0].endpoints = ["A1.D9", "R1[1]"];
    doc.circuit.nets[2].endpoints = ["A1{GND}", "D1[K]"];
    const p = loaded(doc);
    const defs = projectPinDefs(p);
    expect(resolveEndpoint("A1.SCK", defs)).toMatchObject({ ok: false, issue: { code: "E106" } });
    // JDIGITAL SDA duplicates A4: one terminal each, one group, so they are one electrical class.
    const sda = resolveEndpoint("A1.SDA", defs), a4 = resolveEndpoint("A1.A4", defs);
    expect(sda).toMatchObject({ ok: true, ep: { kind: "terminal", number: "JD-17" } });
    expect(a4).toMatchObject({ ok: true, ep: { kind: "terminal", number: "JA-13" } });
    expect(sda.ok && a4.ok && classOf(sda.ep, defs) === classOf(a4.ep, defs)).toBe(true);
    expect(resolveEndpoint("A1.D18", defs)).toMatchObject({ ok: true, ep: { number: "JA-13" } }); // alias
    expect(groupRepresentative("A1", "GND", defs)).toBe("ICSP1-6"); // phase0 AUTHOR-NOTES item 9
    expect(p.circuit.parts[0]!.props).toEqual({ controller: "true" });
  });

  it("a definition in assets wins over the library; it is validated; unknown modules are E202", () => {
    const custom = structuredClone(MODULE_LIBRARY["module:pololu-d24v10f5"]!) as any;
    custom.pins[0].name = "POWER_GOOD";
    const doc = moduleProject() as any;
    doc.circuit.parts.push({ id: "U2", type: "module:pololu-d24v10f5" });
    doc.assets.definitions["module:pololu-d24v10f5"] = custom;
    const p = loaded(doc);
    expect(p.circuit.parts.find((x) => x.id === "U2")!.pins![0]!.name).toBe("POWER_GOOD");
    expect(p.circuit.parts.find((x) => x.id === "U2")!.props).toBeUndefined(); // not a controller
    const broken = structuredClone(doc);
    broken.assets.definitions["module:pololu-d24v10f5"].pins[1].number = "1";
    expect(loadProject(broken).errors.map((e) => e.message).join()).toMatch(/duplicate pin number/);
    const unknown = moduleProject() as any;
    unknown.circuit.parts[0].type = "module:esp8266-made-up";
    expect(loadProject(unknown).errors[0]).toMatchObject({ code: "E202" });
  });

  it("a module may name a preferred representative per group (SPEC 6.2, 7.3, rev C.3)", () => {
    const doc = moduleProject() as any;
    const def = structuredClone(MODULE_LIBRARY["module:esp32-devkitc-v4"]!) as any;
    def.representatives = { GND: "J3-7" };
    doc.assets.definitions["module:esp32-devkitc-v4"] = def;
    const p = loaded(doc);
    const defs = projectPinDefs(p);
    expect(groupRepresentative("U1", "GND", defs)).toBe("J3-7");
    expect(groupRepresentative("U1", "GND", defs, new Set(["U1[J3-7]"]))).toBe("J2-14"); // no-connect: back to the lowest
    const r = layout(p);
    expect(r.status.startsWith("valid"), r.issues.join("; ")).toBe(true);
    const drawn = r.render!.electrical.pins.filter((x) => x.part === "U1").map((x) => x.number);
    expect(drawn).toContain("J3-7");
    expect(drawn).not.toContain("J2-14");
    expect(checkDrawing(p.circuit, r.pinDefs, r.render!).valid).toBe(true);
    expect(JSON.parse(saveProject(p)).assets.definitions["module:esp32-devkitc-v4"].representatives).toEqual({ GND: "J3-7" });
    def.representatives = { GND: "J2-10" }; // not a GND pin
    expect(loadProject(doc).errors.map((e) => e.message).join()).toMatch(/representatives: "J2-10" is not a pin of group "GND"/);
  });

  it("saving embeds the module definition and writes the part as written (no pins, no derived controller)", () => {
    const doc = moduleProject();
    const p = loaded(doc);
    const out = JSON.parse(saveProject(p));
    expect(out.circuit.parts[0]).toEqual({ id: "U1", type: "module:esp32-devkitc-v4" });
    expect(out.assets.definitions["module:esp32-devkitc-v4"]).toEqual(MODULE_LIBRARY["module:esp32-devkitc-v4"]);
    expect(out.circuit.nets[0].endpoints).toEqual(["R1[1]", "U1[J2-10]"]); // canonical, sorted
    expect(out.circuit.nets[2].endpoints).toEqual(["D1[K]", "U1{GND}"]);
    const again = loaded(out);
    expect(saveProject(again)).toBe(saveProject(p));
  });

  it("a module part lays out as a generated box and passes the verifier, ranked as a controller", () => {
    const p = loaded(moduleProject());
    const r = layout(p);
    expect(r.status.startsWith("valid"), r.issues.join("; ")).toBe(true);
    const q = checkDrawing(p.circuit, r.pinDefs, r.render!);
    expect(q.valid, JSON.stringify([...q.connections.errors, ...q.overlaps])).toBe(true);
    expect(r.state!.parts.U1!.at[0]).toBeLessThan(r.state!.parts.R1!.at[0]); // controller ranks first (left)
  });
});

// ---------------------------------------------------------------------------

describe("decouples hints (SPEC 6.4)", () => {
  const case7 = () => json(join(VALIDATION, "case07-two-ic-decoupling.json"));

  it("case 7: four decouples hints load into intent", () => {
    const p = loaded(case7());
    expect(p.intent.hints).toEqual([
      { id: "h1", type: "decouples", part: "C1", pin: "U1[7]", priority: "normal" },
      { id: "h2", type: "decouples", part: "C2", pin: "U1[20]", priority: "normal" },
      { id: "h3", type: "decouples", part: "C3", pin: "U2[8]", priority: "normal" },
      { id: "h4", type: "decouples", part: "C4", pin: "U2[8]", priority: "normal" },
    ]);
  });

  it("must name a capacitor (E261) and an existing pin of another part (E262)", () => {
    const codes = (h: object) => { const d = case7(); d.intent.hints = [{ id: "h1", type: "decouples", priority: "normal", ...h }]; return loadProject(d).errors.map((e) => e.code); };
    expect(codes({ part: "R1", pin: "U1[7]" })).toEqual(["E261"]);
    expect(codes({ part: "C1", pin: "U1[99]" })).toEqual(["E262"]);
    expect(codes({ part: "C1", pin: "U7[1]" })).toEqual(["E262"]);
    expect(codes({ part: "C1", pin: "C1[2]" })).toEqual(["E262"]);
    expect(codes({ part: "C9", pin: "U1[7]" })).toEqual(["E251"]);
    expect(codes({ part: "C1", pin: "U1.VCC" })).toEqual([]); // by name is fine
    expect(codes({ part: "C1" })).toEqual(["E260"]);
  });

  it("warns (W263) when the capacitor is not on the pin's net", () => {
    const d = case7();
    d.intent.hints[0].pin = "U1[1]"; // RESET: C1 is not on it
    const r = loadProject(d);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["W263"]);
  });

  it("unknown hint types are refused with the supported list (E260); duplicate hint ids too", () => {
    const d = case7();
    d.intent.hints.push({ id: "h5", type: "near", part: "C1", of: "U1", priority: "normal" });
    expect(loadProject(d).errors[0]!.message).toMatch(/"near" is not supported \(supported: relative, align, orient, pinSides, decouples\)/);
    const p = loaded(case7());
    const dup = [...p.intent.hints!, p.intent.hints![0]!] as Hint[];
    expect(checkHints(dup, p.circuit, projectPinDefs(p)).errors.map((e) => e.code)).toEqual(["E260"]);
  });
});

// ---------------------------------------------------------------------------

describe("edit scripts (SPEC 11.3)", () => {
  const script = (ops: unknown[]): EditScript => { const r = parseEditScript({ ops }); if (!r.ok) throw new Error(JSON.stringify(r.issues)); return r.script; };

  it("parses every operation kind and refuses unknown or malformed ones", () => {
    const all = [
      { op: "connect", endpoints: ["R1[1]", "D1[A]"] }, { op: "disconnect", endpoint: "R1[1]" }, { op: "mergeNets", nets: ["n1", "n2"], keep: "n1" },
      { op: "renameNet", net: "n1", name: "X" }, { op: "setNoConnect", terminal: "U1[J2-2]", nc: true }, { op: "renamePart", from: "R1", to: "R2" },
      { op: "removePart", part: "R1" }, { op: "addPart", part: { id: "C1", type: "capacitor" } }, { op: "setProp", part: "R1", key: "value", value: null },
      { op: "lock", part: "R1" }, { op: "unlock", part: "R1" }, { op: "setOrientation", part: "R1", rot: 90 }, { op: "setPinSides", part: "U1", left: ["U1[J2-10]"] },
      { op: "setLabelSide", part: "R1", side: "below" }, { op: "setSpacing", factor: 1.5 }, { op: "place", part: "D1", rel: "right-of", of: "R1" },
      { op: "align", axis: "row", parts: ["R1", "D1"] }, { op: "removeHint", id: "h1" }, { op: "relayout", mode: "canonical" },
    ];
    expect(parseEditScript(all).ok).toBe(true);
    expect(parseEditScript([{ op: "explode" }])).toMatchObject({ ok: false, issues: [{ code: "E102" }] });
    expect(parseEditScript([{ op: "setHint", hint: {} }])).toMatchObject({ ok: false, issues: [{ code: "E108" }] });
    expect(parseEditScript([{ op: "setProp", part: "R1" }])).toMatchObject({ ok: false, issues: [{ code: "E102" }] });
    expect(parseEditScript({ ops: [], expect: { ok: "maybe" } })).toMatchObject({ ok: false });
  });

  it("applies each operation kind through the edit transaction", () => {
    const p = loaded(moduleProject());
    const prev = layout(p).state!;
    const cases: Array<[string, unknown[], (q: LoadedProject) => void]> = [
      ["connect", [{ op: "addPart", part: { id: "C1", type: "capacitor", props: { value: "100n" } } }, { op: "connect", endpoints: ["C1[1]", "U1[J2-1]"] }, { op: "connect", endpoints: ["C1[2]", "U1.GND"] }],
        (q) => expect(q.circuit.nets.find((n) => n.name === "GND")!.endpoints).toContain("C1[2]")],
      ["disconnect", [{ op: "disconnect", endpoint: "D1[K]" }, { op: "setNoConnect", terminal: "D1[K]", nc: true }], (q) => expect(q.circuit.nc).toEqual(["D1[K]"])],
      ["renameNet", [{ op: "renameNet", net: "n2", name: "ANODE" }], (q) => expect(q.circuit.nets[1]!.name).toBe("ANODE")],
      ["mergeNets", [{ op: "mergeNets", nets: ["n1", "n2"], keep: "n1" }, { op: "removePart", part: "R1" }], (q) => expect(q.circuit.nets.map((n) => n.id)).toEqual(["n1", "n3"])],
      ["setProp", [{ op: "setProp", part: "R1", key: "value", value: "4k7 1% 0603" }], (q) => expect(q.circuit.parts[1]!.props).toEqual({ value: "4k7 1% 0603" })],
      ["lock", [{ op: "lock", part: "R1" }], (q) => expect(q.intent.locks).toEqual([{ part: "R1", ...{ x: prev.parts.R1!.at[0], y: prev.parts.R1!.at[1] }, rot: prev.parts.R1!.orient.rot, flip: prev.parts.R1!.orient.flip }])],
      ["unlock", [{ op: "lock", part: "R1" }, { op: "unlock", part: "R1" }], (q) => expect(q.intent.locks).toEqual([])],
      ["setOrientation", [{ op: "setOrientation", part: "D1", rot: 270 }], (q) => expect(q.intent.hints![0]).toMatchObject({ type: "orient", part: "D1", rot: 270 })],
      ["setPinSides", [{ op: "setPinSides", part: "U1", right: ["U1[J2-10]", "U1[J2-14]"] }], (q) => expect(q.intent.hints![0]).toMatchObject({ type: "pinSides", sides: { right: ["J2-10", "J2-14"] } })],
      ["setLabelSide", [{ op: "setLabelSide", part: "R1", side: "below" }], (q) => expect(q.intent.overrides!.labelSide).toEqual({ R1: "below" })],
      ["setSpacing", [{ op: "setSpacing", factor: 1.5 }], (q) => expect(q.intent.spacing).toBe(1.5)],
      ["place", [{ op: "place", part: "D1", rel: "below", of: "R1" }], (q) => expect(q.intent.hints![0]).toMatchObject({ type: "relative", rel: "below" })],
      ["align", [{ op: "align", axis: "row", parts: ["R1", "D1"] }], (q) => expect(q.intent.hints![0]).toMatchObject({ type: "align", axis: "row" })],
      ["removeHint", [{ op: "align", axis: "row", parts: ["R1", "D1"] }, { op: "removeHint", id: "h1" }], (q) => expect(q.intent.hints).toEqual([])],
      ["relayout", [{ op: "relayout", mode: "canonical" }], (q) => expect(revision(q)).toBe(revision(p))],
      ["renamePart", [{ op: "renamePart", from: "D1", to: "LED1" }], (q) => expect(q.circuit.nets[2]!.endpoints).toContain("LED1[K]")],
      ["addPart module", [{ op: "addPart", part: { id: "U2", type: "module:pololu-d24v10f5" } }, { op: "connect", endpoints: ["U2.GND", "D1[K]"] }],
        (q) => { expect(q.circuit.parts.find((x) => x.id === "U2")!.pins).toHaveLength(5); expect(Object.keys(q.assets.definitions)).toContain("module:pololu-d24v10f5"); expect(JSON.parse(saveProject(q)).assets.definitions["module:pololu-d24v10f5"]).toEqual(MODULE_LIBRARY["module:pololu-d24v10f5"]); }],
    ];
    for (const [name, ops, check] of cases) {
      const run = applyEditScript(p, script(ops), prev);
      expect(run.result.saved, `${name}: ${run.result.issues.join("; ")}`).toBe(true);
      check(run.project!);
      expect(loadProject(saveProject(run.project!)).ok, `${name}: saved file loads`).toBe(true);
    }
  });

  it("rejects setPinSides on a fixed symbol (E270) and leaves the project unchanged", () => {
    const p = loaded(json(join(VALIDATION, "case03-summing.json")));
    const run = applyEditScript(p, script([{ op: "setPinSides", part: "U1", left: ["U1[3]", "U1[2]"] }]));
    expect(run.result.saved).toBe(false);
    expect(run.result.issues[0]).toMatch(/^E270 .*setOrientation \{ part: "U1", rot: 180, flip: true \}/); // SPEC 11.3 rev C.3
    expect(run.result.project).toBe(p);
    // The orientation it names really gives IN+ above IN- on the left and OUT on the right.
    const o = { rot: 180, flip: true } as const;
    const pin = (n: string) => { const q = BUILTIN.opamp!.pins.find((x) => x.number === n)!; return { at: xformPt(q.at, [0, 0], o), dir: xformDir(q.dir, o) }; };
    expect([pin("3").dir, pin("2").dir, pin("1").dir]).toEqual(["left", "left", "right"]);
    expect(pin("3").at[1]).toBeLessThan(pin("2").at[1]);
    // A pin list no orientation of the symbol can give says so.
    const q = loaded({ circuit: { parts: [{ id: "Q1", type: "npn" }, { id: "R1", type: "resistor" }], nets: [{ id: "n1", endpoints: ["Q1[B]", "R1[1]"] }] } });
    const none = applyEditScript(q, script([{ op: "setPinSides", part: "Q1", left: ["Q1[B]", "Q1[C]", "Q1[E]"] }]));
    expect(none.result.issues[0]).toMatch(/^E270 .*No orientation/);
  });

  it("affected parts: port-drawn power and ground nets do not spread (SPEC 9.5, rev C.3)", () => {
    const doc = moduleProject() as any;
    doc.circuit.nets[2].endpoints.push("R1[2]"); // three endpoints: GND is drawn with ground symbols
    doc.circuit.nets[1].endpoints = ["D1[A]", "U1[J2-9]"];
    const g = loaded(doc);
    const gPrev = layout(g).state!;
    expect(gPrev.routes.n3!.ports).toBe(true);
    const add = applyEditScript(g, script([{ op: "addPart", part: { id: "C1", type: "capacitor" } }, { op: "connect", endpoints: ["C1[1]", "U1[J2-10]"] }, { op: "connect", endpoints: ["C1[2]", "U1.GND"] }]), gPrev);
    expect(add.result.saved, add.result.issues.join("; ")).toBe(true);
    expect(add.affected.actual).toEqual(["C1", "R1", "U1"]); // LED net (wired): U1, R1; GND (ports): only C1
  });

  it("removePart removes the hints, lock and label side naming the part and lists the hint ids; renamePart rewrites a decouples pin", () => {
    const d = json(join(VALIDATION, "case07-two-ic-decoupling.json"));
    d.intent.hints.push({ id: "h5", type: "align", axis: "row", parts: ["C3", "C4"], priority: "normal" }, { id: "h6", type: "align", axis: "row", parts: ["C1", "C2", "C4"], priority: "normal" });
    d.intent.overrides = { labelSide: { C4: "below", C3: "above" } };
    const free = layout(loaded(d)).state!.parts.C4!; // lock C4 where it is drawn
    d.intent.locks = [{ part: "C4", x: free.at[0], y: free.at[1], rot: free.orient.rot, flip: free.orient.flip }];
    const p = loaded(d);
    const prev = layout(p).state;
    const rm = applyEditScript(p, script([{ op: "removePart", part: "C4" }]), prev);
    expect(rm.result.saved, rm.result.issues.join("; ")).toBe(true);
    expect(rm.removedHints).toEqual(["h4", "h5"]);
    expect(rm.result.removedHints).toEqual(["h4", "h5"]);
    expect(rm.project!.intent.hints!.find((h) => h.id === "h6")).toMatchObject({ parts: ["C1", "C2"] }); // two parts remain
    expect(rm.project!.intent.locks).toEqual([]);
    expect(rm.project!.intent.overrides!.labelSide).toEqual({ C3: "above" });
    const rn = applyEditScript(p, script([{ op: "renamePart", from: "U2", to: "EEPROM" }]), prev);
    expect(rn.result.saved, rn.result.issues.join("; ")).toBe(true);
    expect(rn.project!.intent.hints!.filter((h) => h.type === "decouples").map((h) => (h as { pin: string }).pin)).toEqual(["U1[7]", "U1[20]", "EEPROM[8]", "EEPROM[8]"]);
  });

  describe("frozen Phase 0b edit scripts (cases 3, 5, 7)", () => {
    // Affected parts by the rev C.3 rule (port-drawn nets do not spread), where they differ from the
    // frozen expect.affectedParts, which follow the rev C.2 table. Worked out by hand from SPEC 9.5.
    const C3: Record<string, string[]> = {
      "03-remove-part": ["Rf", "U1"], // RL was on OUT (wired: U1, Rf) and GND (ports)
      "05-add-part": ["C1"], // C1 joins 3V3 and GND, both drawn with ports
      "07-add-part": ["C5", "R1", "U1"], // RESET is wired (R1, U1); GND is ports
      "07-remove-part": ["U2"], // removeHint h4 names C4 and U2[8]; C4 was on 5V and GND (ports)
    };
    const run = (c: string, kind: string) => {
      const s = readEditScript(join(EDITS, `case${c}-${kind}.json`));
      if (!s.ok) throw new Error(JSON.stringify(s.issues));
      const p = loaded(json(join(ROOT, "phase0", "cases", s.script.case!)));
      const before = layout(p);
      return { script: s.script, r: applyEditScript(p, s.script, before.state) };
    };
    for (const c of ["03", "05", "07"]) for (const kind of ["longer-value", "add-part", "remove-part", "pin-sides"]) {
      it(`case${c}-${kind}: applies as expected; affected parts by the rev C.3 rule, frozen list reported beside them`, () => {
        const { script: s, r } = run(c, kind);
        expect(r.asExpected, r.result.issues.join("; ")).toBe(true);
        if (s.expect?.ok === true) expect(r.result.saved, r.result.issues.join("; ")).toBe(true);
        if (!r.result.saved) return; // case 3 pin sides: rejected (E270), which the script accepts
        const want = C3[`${c}-${kind}`] ?? s.expect!.affectedParts!;
        expect(r.affected.actual).toEqual(want);
        expect(r.affected.expected).toEqual(s.expect!.affectedParts);
        expect(r.affected.match).toBe(C3[`${c}-${kind}`] === undefined);
        expect(r.stability).toBeDefined();
        expect(r.result.check!.connections.valid).toBe(true);
      });
    }
  });
});

describe("reading from disk", () => {
  it("readProject reads a validation case", () => {
    const r = readProject(join(VALIDATION, "case02-divider-buffer.json"));
    expect(r.ok).toBe(true);
    expect(r.project!.meta).toEqual({ title: "Case 2: voltage divider feeding an op-amp buffer", created: "2026-10-23", nextNetId: 5, nextHintId: 1 });
  });
});
