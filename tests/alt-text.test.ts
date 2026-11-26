// Reader-facing alt text and net connectivity table (SPEC 10.4).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { layout, type Project } from "../src/layout/layout.js";
import { altText, netTable, netTableMarkdown, type NetTableRow } from "../src/quality/alt-text.js";
import { generate } from "./support/generate.js";

const ROOT = join(import.meta.dirname, "..");
const load = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), "utf8")) as Project;

const NO_FANCY_DASHES = /[\u2013\u2014]/;

describe("altText, netTable, and netTableMarkdown (SPEC 10.4)", () => {
  it("describes a simple LED circuit with wire-drawn power/ground rails and canonical net table", () => {
    const project = load("cases/case01-led.json");
    const r = layout(project);
    expect(r.status).toBe("valid");

    const rows = netTable(project.circuit, r.pinDefs, r.render!);
    expect(rows).toEqual([
      { id: "n1", name: "PWR", kind: "power", domain: null, presentation: "wire", pins: ["B1[+]", "R1[1]"] },
      { id: "n3", name: "GND", kind: "ground", domain: null, presentation: "wire", pins: ["B1[-]", "D1[K]"] },
      { id: "n2", name: "n2", kind: "signal", domain: null, presentation: "wire", pins: ["D1[A]", "R1[2]"] },
    ]);

    const md = netTableMarkdown(rows);
    expect(md).toBe([
      "| Net | Kind | Presentation | Connected pins |",
      "| --- | --- | --- | --- |",
      "| PWR | power | wire | B1[+], R1[1] |",
      "| GND | ground | wire | B1[-], D1[K] |",
      "| n2 | signal | wire | D1[A], R1[2] |",
    ].join("\n"));

    const text = altText(project.circuit, r.pinDefs, r.render!, [...(r.state?.templates ?? []), ...r.notes]);
    expect(text).toContain("Case 1: LED indicator");
    expect(text).toContain("3 parts");
    expect(text).toContain("1 battery");
    expect(text).toContain("1 LED");
    expect(text).toContain("1 resistor");
    expect(text).toContain("Power rail: PWR (2 pins, wires)");
    expect(text).toContain("Ground rail: GND (2 pins, wires)");
    expect(text).toContain("R1");
    expect(text).toContain("D1");
    expect(text).not.toMatch(/inferred/i);
    expect(text).not.toMatch(NO_FANCY_DASHES);
    expect(md).not.toMatch(NO_FANCY_DASHES);
  });

  it("marks matched op-amp templates as inferred and omits functional words without template notes", () => {
    const project = load("cases/case03-summing.json");
    const r = layout(project);
    expect(r.status).toBe("valid");
    expect(r.state?.templates?.some((t) => t.startsWith("opamp-inverting@"))).toBe(true);

    const withTemplates = altText(project.circuit, r.pinDefs, r.render!, [...(r.state?.templates ?? []), ...r.notes]);
    expect(withTemplates).toMatch(/Inferred structures? \(from matched templates?\)/);
    expect(withTemplates).toContain("inverting op-amp stage");
    expect(withTemplates).toContain("pull-down resistor");
    expect(withTemplates).toContain("Ground rail: GND (5 pins, ports)");
    expect(withTemplates).toContain("V1");
    expect(withTemplates).toContain("U1");
    expect(withTemplates).toContain("RL");
    expect(withTemplates).not.toMatch(NO_FANCY_DASHES);

    // Without template notes (and even if an abandoned note is present), no inferred template wording appears.
    const withoutTemplates = altText(project.circuit, r.pinDefs, r.render!, [
      "template opamp-inverting@1:R1,R2,R3,Rf,U1 abandoned: overlap",
      "decoupling@1: C1 placed next to U1[8]",
    ]);
    expect(withoutTemplates).not.toMatch(/inferred/i);
    expect(withoutTemplates).not.toContain("inverting op-amp stage");
    expect(withoutTemplates).not.toContain("pull-down resistor");
    expect(withoutTemplates).not.toMatch(NO_FANCY_DASHES);

    const rows = netTable(project.circuit, r.pinDefs, r.render!);
    const gnd = rows.find((row) => row.name === "GND");
    expect(gnd?.presentation).toBe("port");
    expect(gnd?.pins).toEqual(["RL[2]", "U1[3]", "V1[-]", "V2[-]", "V3[-]"]);
    const sum = rows.find((row) => row.name === "SUM");
    expect(sum?.presentation).toBe("wire");
    expect(sum?.pins).toEqual(["R1[2]", "R2[2]", "R3[2]", "Rf[1]", "U1[2]"]);
  });

  it("handles an untitled non-inverting op-amp circuit cleanly with and without matched template notes", () => {
    const project: Project = {
      circuit: {
        parts: [
          { id: "V1", type: "vsource", props: { value: "1V" } },
          { id: "U1", type: "opamp", props: { value: "TL072" } },
          { id: "Rf", type: "resistor", props: { value: "10k" } },
          { id: "Rg", type: "resistor", props: { value: "10k" } },
        ],
        nets: [
          { id: "n_in", name: "VIN", endpoints: ["V1.+", "U1.IN+"] },
          { id: "n_fb", name: "FB", endpoints: ["U1.IN-", "Rf.1", "Rg.1"] },
          { id: "n_out", name: "VOUT", endpoints: ["U1.OUT", "Rf.2"] },
          { id: "n_gnd", name: "GND", endpoints: ["V1.-", "Rg.2"] },
        ],
      },
    };
    const r = layout(project);
    expect(r.status).toBe("valid");
    expect(r.state?.templates?.some((t) => t.startsWith("opamp-noninverting@"))).toBe(true);

    const structural = altText(project.circuit, r.pinDefs, r.render!);
    expect(structural.startsWith("Schematic with 4 parts")).toBe(true);
    expect(structural).not.toMatch(/inferred/i);
    expect(structural).not.toMatch(/amplifier/i);
    expect(structural).not.toMatch(NO_FANCY_DASHES);

    const withNotes = altText(project.circuit, r.pinDefs, r.render!, r.state?.templates);
    expect(withNotes).toContain("Inferred structure (from matched template): non-inverting op-amp stage");
    expect(withNotes).not.toMatch(NO_FANCY_DASHES);
  });

  it("describes multi-IC circuits with port rails, named signal buses, and grouped pins", () => {
    const i2c = load("cases/case05-i2c.json");
    const r5 = layout(i2c);
    expect(r5.status).toBe("valid");

    const rows5 = netTable(i2c.circuit, r5.pinDefs, r5.render!);
    expect(rows5.map((row) => [row.name, row.kind, row.presentation])).toEqual([
      ["3V3", "power", "port"],
      ["GND", "ground", "port"],
      ["SCL", "signal", "wire"],
      ["SDA", "signal", "wire"],
    ]);

    const alt5 = altText(i2c.circuit, r5.pinDefs, r5.render!, r5.state?.templates);
    expect(alt5).toContain("Key devices: U1 (ESP32-DevKitC), U2 (BME280), and U3 (SHT31).");
    expect(alt5).toContain("Inferred structure (from matched template): I2C bus with pull-up resistors");
    expect(alt5).toContain("Power rail: 3V3 (5 pins, ports)");
    expect(alt5).toContain("Ground rail: GND (3 pins, ports)");
    expect(alt5).toContain("(SCL and SDA)");
    expect(alt5).not.toMatch(NO_FANCY_DASHES);

    // Two ICs with grouped power/ground pins and decoupling capacitors.
    const dec = load("phase0/cases/validation/case07-two-ic-decoupling.json");
    const r7 = layout(dec);
    expect(r7.status).toBe("valid");

    const rows7 = netTable(dec.circuit, r7.pinDefs, r7.render!);
    const v5 = rows7.find((row) => row.name === "5V")!;
    expect(v5.presentation).toBe("port");
    expect(v5.pins).toContain("U1[7]");
    expect(v5.pins).toContain("U1[20]");
    expect(v5.pins).toContain("U2[8]");
    // Natural canonical ordering puts U1[7] before U1[20].
    expect(v5.pins.indexOf("U1[7]")).toBeLessThan(v5.pins.indexOf("U1[20]"));

    const gnd7 = rows7.find((row) => row.name === "GND")!;
    expect(gnd7.presentation).toBe("port");
    expect(gnd7.pins).toContain("U2[1]");
    expect(gnd7.pins).toContain("U2[7]");

    const alt7 = altText(dec.circuit, r7.pinDefs, r7.render!, r7.state?.templates);
    expect(alt7).toContain("ATMEGA328P-PU");
    expect(alt7).toContain("24LC256-I/P");
    expect(alt7).toContain("Power rail: 5V");
    expect(alt7).toContain("Ground rail: GND");
    expect(alt7).not.toMatch(NO_FANCY_DASHES);
  });

  it("is strictly deterministic across repeated calls and shuffled template notes", () => {
    const g = generate(30, 16);
    const project: Project = { meta: { title: "Generated 30-part benchmark" }, circuit: g.circuit };
    const r = layout(project);
    expect(r.status).toBe("valid");

    const templates = [...(r.state?.templates ?? [])];
    const reversed = [...templates].reverse();

    const a1 = altText(project.circuit, r.pinDefs, r.render!, templates);
    const a2 = altText(project.circuit, r.pinDefs, r.render!, reversed);
    expect(a1).toBe(a2);
    expect(a1).not.toMatch(NO_FANCY_DASHES);

    const t1 = netTable(project.circuit, r.pinDefs, r.render!);
    const t2 = netTable(project.circuit, r.pinDefs, r.render!);
    expect(t1).toEqual(t2);
    expect(netTableMarkdown(t1)).toBe(netTableMarkdown(t2));
    expect(netTableMarkdown(t1)).not.toMatch(NO_FANCY_DASHES);
  });

  it("sanitizes em dashes and en dashes from titles and Markdown cells, and renders domains", () => {
    const project: Project = {
      meta: { title: "Analog stage \u2014 rev 1\u20132" },
      circuit: {
        parts: [
          { id: "R1", type: "resistor", props: { value: "10k" } },
          { id: "R2", type: "resistor", props: { value: "10k" } },
        ],
        nets: [
          { id: "n1", name: "VCC", domain: "analog", endpoints: ["R1.1"] },
          { id: "n2", name: "MID", endpoints: ["R1.2", "R2.1"] },
          { id: "n3", name: "GND", domain: "analog", endpoints: ["R2.2"] },
        ],
      },
    };
    const r = layout(project);
    expect(r.status).toBe("valid");

    const rows = netTable(project.circuit, r.pinDefs, r.render!);
    expect(rows.find((x) => x.id === "n1")?.domain).toBe("analog");
    const md = netTableMarkdown(rows);
    expect(md).toContain("| VCC (analog) | power |");
    expect(md).toContain("| GND (analog) | ground |");
    expect(md).not.toMatch(NO_FANCY_DASHES);

    const text = altText(project.circuit, r.pinDefs, r.render!, r.state?.templates);
    expect(text).toContain("Analog stage - rev 1-2");
    expect(text).toContain("VCC (analog)");
    expect(text).toContain("GND (analog)");
    expect(text).not.toMatch(NO_FANCY_DASHES);

    // Pipe characters and empty pin lists in netTableMarkdown are formatted safely.
    const customRows: NetTableRow[] = [
      { id: "n0", name: "A|B \u2014 C", kind: "signal", domain: null, presentation: "wire", pins: [] },
    ];
    const customMd = netTableMarkdown(customRows);
    expect(customMd).toContain("| A\\|B - C | signal | wire | - |");
    expect(customMd).not.toMatch(NO_FANCY_DASHES);
  });

  it("rejects drawings that fail electrical verification rather than reporting unverified connectivity", () => {
    const project = load("cases/case01-led.json");
    const r = layout(project);
    expect(r.status).toBe("valid");

    // Break connectivity by dropping all wires from render.electrical.
    const broken = {
      ...r.render!,
      electrical: { ...r.render!.electrical, wires: [] },
    };
    expect(() => netTable(project.circuit, r.pinDefs, broken)).toThrow(/unverified drawing/i);
    expect(() => altText(project.circuit, r.pinDefs, broken)).toThrow(/unverified drawing/i);
  });
});
