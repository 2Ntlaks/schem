import { describe, expect, it } from "vitest";
import { compileDsl } from "../src/core/dsl.js";
import { formatDsl } from "../src/core/dsl-format.js";
import { loadProject, saveProject } from "../src/io/project.js";
import { BUILTIN } from "../src/symbols/library.js";

describe("JSON to text DSL", () => {
  it("round trips canonical JSON exactly, including regenerated ids and ordered hints", () => {
    const source = [
      'circuit "Sensor #1"',
      "style theme=clean symbols=ieee",
      "part U1 ic \"A board\" pins: 3:VIN/power_in 8:GND/ground@gnd 9:GND/ground@gnd 10:SDA/bidir",
      "part C1 capacitor 100n",
      "part R1 resistor 10k",
      "net 3V3 = U1.VIN C1[1] R1[1]",
      'net GND domain="analog ground" = U1.GND C1[2]',
      "net DATA = U1.SDA R1[2]",
      "nc U1[9]",
      "hint near R1 U1 priority=high",
      "hint C1 decouples U1.VIN",
      "hint U1 pins-left U1[10]",
      "hint strict row R1 C1",
      "hint C1 vertical",
      "lock U1 at -3,10 rotate 180 flip",
      "override R1 label-side=below",
      "override net DATA at U1[10] style=label",
    ].join("\n");
    const compiled = compileDsl(source);
    expect(compiled.errors).toEqual([]);
    const json = saveProject(compiled.project!);
    const loaded = loadProject(json);
    expect(loaded.errors).toEqual([]);
    const printed = formatDsl(loaded.project!);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    const recompiled = compileDsl(printed.source);
    expect(recompiled.errors).toEqual([]);
    expect(saveProject(recompiled.project!)).toBe(json);
    expect(formatDsl(recompiled.project!)).toEqual(printed);
  });

  it("regenerates bookkeeping and ignores an identical built-in definition", () => {
    const loaded = loadProject({
      schema: "schem/1.0",
      meta: { nextNetId: 37, nextHintId: 59 },
      assets: { definitions: { resistor: BUILTIN.resistor } },
      circuit: { parts: [{ id: "R1", type: "resistor" }], nets: [{ id: "n21", name: "TEST", endpoints: ["R1[1]"] }] },
    });
    expect(loaded.errors).toEqual([]);
    const printed = formatDsl(loaded.project!);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    const compiled = compileDsl(printed.source);
    expect(compiled.errors).toEqual([]);
    expect(compiled.project!.meta).toEqual({ nextNetId: 2, nextHintId: 1 });
    expect(compiled.project!.circuit.nets[0]?.id).toBe("n1");
  });

  it("allows empty unknown JSON fields to be dropped in text conversion", () => {
    const loaded = loadProject({
      meta: { customDate: "" },
      future: {},
      circuit: { parts: [{ id: "R1", type: "resistor" }], nets: [] },
    });
    expect(loaded.errors).toEqual([]);
    expect(formatDsl(loaded.project!)).toEqual({ ok: true, source: "part R1 resistor\n" });
  });

  it("lists every lossy field instead of printing partial text", () => {
    const loaded = loadProject({
      schema: "schem/1.0",
      meta: { created: "2026-11-19", other: "keep me" },
      assets: { definitions: { resistor: { id: "resistor", value: "custom" } } },
      ext: { owner: "lab" },
      circuit: {
        parts: [{ id: "U1", type: "ic", pins: [{ number: "1", name: "DATA", role: "bidir", aliases: ["SDA"], iface: ["i2c.sda"] }, { number: "2", name: "REF" }] }],
        nets: [{ id: "n1", endpoints: ["U1[1]", "U1[2]"], kind: "power" }],
      },
      intent: { spacing: 2, overrides: { netStyle: [{ net: "n1", style: "wire" }] } },
    });
    expect(loaded.errors).toEqual([]);
    expect(formatDsl(loaded.project!)).toEqual({
      ok: false,
      fields: [
        "assets.definitions[resistor]",
        "circuit.nets[n1].kind",
        "circuit.parts[U1].pins[1].aliases",
        "circuit.parts[U1].pins[1].iface",
        "ext",
        "intent.overrides.netStyle[0].net",
        "intent.spacing",
        "meta.created",
        "meta.other",
      ],
    });
  });
});
