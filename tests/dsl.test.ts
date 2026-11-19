import { describe, expect, it } from "vitest";
import { compileDsl } from "../src/core/dsl.js";
import { edit } from "../src/edit/edit.js";
import { loadProject, saveProject } from "../src/io/project.js";

const led = [
  'circuit "LED #1: \\"red\\" \\\\"',
  "style theme=clean symbols=ieee",
  "part B1 battery 9V",
  "part R1 resistor 470",
  "part D1 led color=red",
  "net PWR = B1.+ R1.1",
  "connect R1.2 D1.anode",
  "net GND = D1.cathode B1.-",
  "hint D1 right-of R1",
].join("\n");

describe("text DSL", () => {
  it("compiles a BOM, CRLF, escapes, continuations and comments", () => {
    const source = "\uFEFF" + led.replace("R1.2 ", "R1.2 \\\n  ").replaceAll("\n", "\r\n") + "\r\n # end";
    const result = compileDsl(source);
    expect(result.errors).toEqual([]);
    expect(result.project!.meta.title).toBe('LED #1: "red" \\');
    expect(result.project!.intent).toEqual({
      style: { theme: "clean", symbols: "ieee" },
      hints: [{ id: "h1", type: "relative", part: "D1", rel: "right-of", of: "R1", priority: "normal" }],
    });
    expect(result.project!.circuit.nets).toEqual([
      { id: "n1", name: "PWR", endpoints: ["B1[+]", "R1[1]"] },
      { id: "n2", name: "GND", endpoints: ["B1[-]", "D1[K]"] },
      { id: "n3", endpoints: ["D1[A]", "R1[2]"] },
    ]);
  });

  it("binds declarations, typed pin groups, hints, locks and overrides", () => {
    const result = compileDsl([
      "hint U1 pins-left U1[2] pins-right OUT priority=high",
      "part U1 ic \"amp\" pins: 2:IN/input 4:GND/ground@gnd 8:GND/ground@gnd 9:OUT/output",
      "part C1 capacitor 100n",
      "part R1 resistor 1k",
      "net GND domain=analog = U1.GND",
      "net SIG kind=signal = U1.OUT R1[1]",
      "net GND = C1[2]",
      "net IN = C1[1] U1.IN",
      "nc U1[8]",
      "hint C1 decouples U1.IN",
      "hint column R1 C1",
      "hint R1 vertical",
      "lock C1 at -2, 4 rotate 270 flip",
      "override R1 label-side=below",
      "override net SIG at U1[9] style=label",
    ].join("\n"));
    expect(result.errors).toEqual([]);
    const p = result.project!;
    expect(p.intent.hints).toEqual([
      { id: "h1", type: "pinSides", part: "U1", priority: "high", sides: { left: ["2"], right: ["9"] } },
      { id: "h2", type: "decouples", part: "C1", priority: "normal", pin: "U1[2]" },
      { id: "h3", type: "align", axis: "column", parts: ["R1", "C1"], priority: "normal" },
      { id: "h4", type: "orient", part: "R1", rot: 90, flip: false, priority: "normal" },
    ]);
    expect(p.intent.locks).toEqual([{ part: "C1", x: -2, y: 4, rot: 270, flip: true }]);
    expect(p.intent.overrides).toEqual({
      labelSide: { R1: "below" },
      netStyle: [{ net: p.circuit.nets.find((n) => n.name === "SIG")!.id, endpoint: "U1[9]", style: "label" }],
    });
    expect(p.circuit.nets.find((n) => n.name === "GND")).toMatchObject({ domain: "analog", endpoints: ["C1[2]", "U1{gnd}"] });
    expect(p.circuit.nc).toEqual(["U1[8]"]);
  });

  it("assigns default pin numbers and roles", () => {
    const result = compileDsl("part U1 ic pins: VIN GND DATA");
    expect(result.errors).toEqual([]);
    expect(result.pinDefs!.U1).toEqual([
      { number: "1", name: "VIN", role: "power_in" },
      { number: "2", name: "GND", role: "ground" },
      { number: "3", name: "DATA", role: "bidir" },
    ]);
  });

  it.each(["pins-right IN OUT", "pins-left OUT IN"])("locates conflicting strict pin hints (%s)", (other) => {
    const result = compileDsl(`part U1 ic pins: IN OUT\nhint strict U1 pins-left IN OUT\nhint strict U1 ${other}`);
    expect(result.errors[0]).toMatchObject({ code: "E263", span: { start: { line: 3, column: 1 } } });
  });

  it("preserves near hints through JSON save and load", () => {
    const result = compileDsl(`${led}\nhint near D1 R1 priority=high`);
    expect(result.errors).toEqual([]);
    const reloaded = loadProject(saveProject(result.project!));
    expect(reloaded.errors).toEqual([]);
    expect(reloaded.project!.schema).toBe("schem/1.1");
    expect(reloaded.project!.intent.hints?.[1]).toEqual({ id: "h2", type: "near", part: "D1", of: "R1", priority: "high" });
    const renamed = edit({ project: reloaded.project!, ops: [{ op: "renamePart", from: "R1", to: "R2" }] });
    expect(renamed.saved).toBe(true);
    expect(renamed.project.intent?.hints?.[1]).toMatchObject({ type: "near", part: "D1", of: "R2" });
  });

  it("expands chains and keeps named nets when connecting to them", () => {
    const choices = led.split("\n").slice(0, 5);
    choices.push("net PWR = B1[+]", "chain B1->R1->D1", "connect B1[-] D1[K]");
    const result = compileDsl(choices.join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.project!.circuit.nets).toEqual([
      { id: "n1", name: "PWR", endpoints: ["B1[+]", "R1[1]"] },
      { id: "n2", endpoints: ["B1[-]", "D1[K]"] },
      { id: "n3", endpoints: ["D1[A]", "R1[2]"] },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["W411", "W411"]);
  });

  it("sets net ids in part code-point and pin natural order", () => {
    const part = "part U1 ic pins: 10:T 2:VCC";
    const result = compileDsl([part, "net TEN = U1[10]", "net TWO = U1[2]"].join("\n"));
    expect(result.errors).toEqual([]);
    expect(result.project!.circuit.nets.map(({ id, name }) => [id, name])).toEqual([["n1", "TWO"], ["n2", "TEN"]]);
  });

  it.each([
    ["part R1 resistor 470\nnet A = R1.3", "E104", "2:9-2:13", "R1 (resistor) has pins 1, 2"],
    ["part U1 ic pins: 14:GND 29:GND 38:GND\nnet G = U1.GND", "E106", "2:9-2:15", "Use U1[14] or U1[29] or U1[38]"],
    ["part R1 resister 470", "E201", "1:9-1:17", 'Did you mean "resistor"?'],
    ["part D1 led\nnet PWR = D1.a\nnet ABC = D1.anode", "E220", "3:1-3:19", "PWR (line 2)"],
    ["part U1 ic pins: 14:GND@gnd 29:GND@gnd\nnet G = U1{gnd}\nnet SIG = U1[14]", "E222", "3:1-3:17", "would short them"],
    ["part R1 resistor 4,7k", "E310", "1:18-1:22", 'Did you mean "4.7k"?'],
    ["part R1 resistor 4uF", "E311", "1:18-1:21", "has unit F"],
    ["part B1 battery 9V\nnet VCC = B1[+]\nnet GND = B1[-]\nconnect B1[+] B1[-]", "E230", "4:1-4:20", "cannot merge power and ground"],
    ['part R1 resistor\ngroup "input" R1', "E260", "2:1-2:17", "does not yet support"],
    ["part R1 resistor\nhint input R1", "E260", "2:1-2:14", "does not yet support"],
    ["part R1 resistor\npart R2 resistor\nhint strict R1 above R2\nhint strict R2 above R1", "E263", "4:1-4:24", "placement constraints conflict"],
    ["part R1 resistor\nhint strict R1 vertical\nhint strict R1 horizontal", "E263", "3:1-3:26", "Conflicting strict orientation"],
  ])("diagnoses %s", (source, code, at, message) => {
    const result = compileDsl(source);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code, at, message: expect.stringContaining(message) });
  });

  it("reports a one-pin net with its source span and canonical nc suggestion", () => {
    const result = compileDsl("part U1 ic pins: 5:GPIO5\nnet SIG = U1.GPIO5");
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([{
      code: "W410",
      at: "2:11-2:19",
      span: { start: { line: 2, column: 11 }, end: { line: 2, column: 19 } },
      message: "net SIG has one endpoint (U1.GPIO5). Connect it or mark it: nc U1[5].",
    }]);
  });
});
