// Verification of the six additional board modules (Raspberry Pi Pico, Arduino Nano,
// ESP32-S3-DevKitC-1, Adafruit BME280, SSD1306 I2C OLED, LM7805) and their text examples.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDsl } from "../src/core/dsl.js";
import { groupRepresentative, resolveEndpoint } from "../src/core/validate.js";
import { loadProject, projectPinDefs, saveProject } from "../src/io/project.js";
import { layout } from "../src/layout/layout.js";
import { checkModuleDef, MODULE_LIBRARY } from "../src/modules/index.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";

const ROOT = join(import.meta.dirname, "..");

const EXTRA_MODULES = [
  { id: "module:raspberry-pi-pico", pins: 40, controller: true },
  { id: "module:arduino-nano", pins: 30, controller: true },
  { id: "module:esp32-s3-devkitc-1", pins: 44, controller: true },
  { id: "module:adafruit-bme280", pins: 7, controller: false },
  { id: "module:ssd1306-oled-i2c", pins: 4, controller: false },
  { id: "module:lm7805", pins: 3, controller: false },
] as const;

function drawAndVerify(source: string): string {
  const compiled = compileDsl(source);
  expect(compiled.errors, JSON.stringify(compiled.errors)).toEqual([]);
  const project = compiled.project!;

  const first = layout(project);
  expect(first.status, first.issues.join("; ")).toBe("valid");
  const check = checkDrawing(project.circuit, first.pinDefs, first.render!);
  expect(check.connections.valid, JSON.stringify(check.connections.errors)).toBe(true);
  expect(check.overlaps, JSON.stringify(check.overlaps)).toEqual([]);
  expect(check.valid).toBe(true);

  const svg1 = toSvg(first.render!);
  const second = layout(project);
  expect(second.status).toBe("valid");
  const svg2 = toSvg(second.render!);
  expect(svg2).toBe(svg1);

  // Saved canonical JSON reloads cleanly and renders byte-identically.
  const reloaded = loadProject(saveProject(project));
  expect(reloaded.errors).toEqual([]);
  const third = layout(reloaded.project!);
  expect(third.status).toBe("valid");
  expect(toSvg(third.render!)).toBe(svg1);

  return svg1;
}

describe("extra board modules: definitions and pins", () => {
  for (const spec of EXTRA_MODULES) {
    it(`${spec.id} loads cleanly with ${spec.pins} pins and official documentation metadata`, () => {
      const def = MODULE_LIBRARY[spec.id];
      expect(def).toBeDefined();
      expect(checkModuleDef(def, spec.id)).toEqual([]);
      expect(def!.pins).toHaveLength(spec.pins);
      expect(def!.controller).toBe(spec.controller);
      expect(def!.doc.url).toMatch(/^https:\/\//);
      expect(def!.doc.revision.length).toBeGreaterThan(0);
      expect(def!.doc.retrieved).toBe("2026-11-26");
    });
  }

  it("raspberry-pi-pico: GND group, 3V3 alias, default I2C0 and SPI0 interfaces", () => {
    const def = MODULE_LIBRARY["module:raspberry-pi-pico"]!;
    const gnds = def.pins.filter((p) => p.group === "GND").map((p) => p.number);
    expect(gnds).toEqual(["3", "8", "13", "18", "23", "28", "33", "38"]);

    const loaded = loadProject({
      schema: "schem/1.0",
      circuit: { parts: [{ id: "U1", type: "module:raspberry-pi-pico" }], nets: [] },
    });
    expect(loaded.ok).toBe(true);
    const defs = projectPinDefs(loaded.project!);
    expect(resolveEndpoint("U1.3V3", defs)).toEqual({ ok: true, ep: { kind: "terminal", part: "U1", number: "36" } });
    expect(resolveEndpoint("U1.GND", defs)).toEqual({ ok: true, ep: { kind: "group", part: "U1", group: "GND" } });
    expect(groupRepresentative("U1", "GND", defs)).toBe("3");
    expect(def.pins.find((p) => p.number === "6")?.iface).toEqual(["i2c.sda"]);
    expect(def.pins.find((p) => p.number === "7")?.iface).toEqual(["i2c.scl"]);
    expect(def.pins.find((p) => p.number === "21")?.iface).toEqual(["spi.miso"]);
    expect(def.pins.find((p) => p.number === "22")?.iface).toEqual(["spi.ss"]);
    expect(def.pins.find((p) => p.number === "24")?.iface).toEqual(["spi.sck"]);
    expect(def.pins.find((p) => p.number === "25")?.iface).toEqual(["spi.mosi"]);
  });

  it("arduino-nano: DIP-30 pinout, GND/RESET groups, I2C A4/A5, SPI D10-D13, analog-only A6/A7", () => {
    const def = MODULE_LIBRARY["module:arduino-nano"]!;
    expect(def.pins.filter((p) => p.group === "GND").map((p) => p.number)).toEqual(["4", "29"]);
    expect(def.pins.filter((p) => p.group === "RESET").map((p) => p.number)).toEqual(["3", "28"]);
    expect(def.pins.find((p) => p.number === "23")).toMatchObject({ name: "A4", iface: ["i2c.sda"] });
    expect(def.pins.find((p) => p.number === "24")).toMatchObject({ name: "A5", iface: ["i2c.scl"] });
    expect(def.pins.find((p) => p.number === "25")).toMatchObject({ name: "A6", role: "input" });
    expect(def.pins.find((p) => p.number === "26")).toMatchObject({ name: "A7", role: "input" });
    expect(def.pins.find((p) => p.number === "27")).toMatchObject({ name: "+5V", role: "power_out" });
    expect(def.pins.find((p) => p.number === "30")).toMatchObject({ name: "VIN", role: "power_in" });
    expect(def.pins.find((p) => p.number === "13")?.iface).toEqual(["spi.ss"]);
    expect(def.pins.find((p) => p.number === "14")?.iface).toEqual(["spi.mosi"]);
    expect(def.pins.find((p) => p.number === "15")?.iface).toEqual(["spi.miso"]);
    expect(def.pins.find((p) => p.number === "16")?.iface).toEqual(["spi.sck"]);
  });

  it("esp32-s3-devkitc-1: J1/J3 44-pin layout, GND and 3V3 groups, aliases", () => {
    const def = MODULE_LIBRARY["module:esp32-s3-devkitc-1"]!;
    expect(def.pins.filter((p) => p.group === "GND").map((p) => p.number)).toEqual(["J1-22", "J3-1", "J3-21", "J3-22"]);
    expect(def.pins.filter((p) => p.group === "3V3").map((p) => p.number)).toEqual(["J1-1", "J1-2"]);
    expect(def.pins.find((p) => p.number === "J3-2")).toMatchObject({ name: "TX", aliases: expect.arrayContaining(["GPIO43", "U0TXD"]) });
    expect(def.pins.find((p) => p.number === "J3-3")).toMatchObject({ name: "RX", aliases: expect.arrayContaining(["GPIO44", "U0RXD"]) });
    expect(def.pins.find((p) => p.number === "J3-19")).toMatchObject({ name: "GPIO20", aliases: expect.arrayContaining(["USB_D+"]) });
    expect(def.pins.find((p) => p.number === "J3-20")).toMatchObject({ name: "GPIO19", aliases: expect.arrayContaining(["USB_D-"]) });
  });

  it("adafruit-bme280, ssd1306-oled-i2c and lm7805: exact pin roles and bus interfaces", () => {
    const bme = MODULE_LIBRARY["module:adafruit-bme280"]!;
    expect(bme.pins.map((p) => p.name)).toEqual(["VIN", "3Vo", "GND", "SCK", "SDO", "SDI", "CS"]);
    expect(bme.pins.find((p) => p.name === "SCK")?.iface).toEqual(["spi.sck", "i2c.scl"]);
    expect(bme.pins.find((p) => p.name === "SDI")?.iface).toEqual(["spi.mosi", "i2c.sda"]);

    const oled = MODULE_LIBRARY["module:ssd1306-oled-i2c"]!;
    expect(oled.pins.map((p) => p.name)).toEqual(["GND", "VCC", "SDA", "SCL"]);
    expect(oled.pins.find((p) => p.name === "SDA")?.iface).toEqual(["i2c.sda"]);
    expect(oled.pins.find((p) => p.name === "SCL")?.iface).toEqual(["i2c.scl"]);

    const reg = MODULE_LIBRARY["module:lm7805"]!;
    expect(reg.pins.map((p) => [p.number, p.name, p.role])).toEqual([
      ["1", "IN", "power_in"],
      ["2", "GND", "ground"],
      ["3", "OUT", "power_out"],
    ]);
  });
});

describe("extra board modules: realistic circuits lay out valid and deterministically", () => {
  const circuits: Array<[string, string]> = [
    [
      "raspberry-pi-pico + ssd1306-oled-i2c",
      `
circuit "Pico I2C OLED test"
part U1 module:raspberry-pi-pico
part OLED1 module:ssd1306-oled-i2c
part R1 resistor 4.7k
part R2 resistor 4.7k
net 3V3 = U1.3V3 OLED1.VCC R1[1] R2[1]
net GND = U1{GND} OLED1.GND
net SDA = U1.GP4 OLED1.SDA R1[2]
net SCL = U1.GP5 OLED1.SCL R2[2]
`,
    ],
    [
      "arduino-nano + adafruit-bme280",
      `
circuit "Nano BME280 test"
part A1 module:arduino-nano
part U1 module:adafruit-bme280
part R1 resistor 4.7k
part R2 resistor 4.7k
net 5V = A1.5V U1.VIN R1[1] R2[1]
net GND = A1{GND} U1.GND
net SDA = A1.SDA U1.SDA R1[2]
net SCL = A1.SCL U1.SCL R2[2]
`,
    ],
    [
      "esp32-s3-devkitc-1 + adafruit-bme280 + status LED",
      `
circuit "ESP32-S3 BME280 sensor node"
part U1 module:esp32-s3-devkitc-1
part U2 module:adafruit-bme280
part R1 resistor 4.7k
part R2 resistor 4.7k
part R3 resistor 330
part D1 led color=green
net 3V3 = U1{3V3} U2.VIN R1[1] R2[1]
net GND = U1{GND} U2.GND D1.cathode
net SDA = U1.GPIO8 U2.SDA R1[2]
net SCL = U1.GPIO9 U2.SCL R2[2]
connect U1.GPIO4 R3[1]
connect R3[2] D1.anode
`,
    ],
    [
      "lm7805 5V regulator",
      `
circuit "LM7805 regulator test"
part B1 battery 12V
part C1 capacitor 330n
part U1 module:lm7805
part C2 capacitor 100n
part R1 resistor 330
part D1 led color=red
connect B1.+ C1[1] U1.IN
net 5V = U1.OUT C2[1] R1[1]
connect R1[2] D1.anode
net GND = B1.- C1[2] U1.GND C2[2] D1.cathode
hint U1 pins-left IN pins-right OUT pins-bottom GND
`,
    ],
  ];

  for (const [label, source] of circuits) {
    it(`${label}: lays out valid, passes layers 1-2, draws deterministically`, () => {
      const svg = drawAndVerify(source);
      expect(svg.startsWith("<svg ")).toBe(true);
    });
  }
});

describe("new text schematic examples in examples/", () => {
  for (const file of ["pico-i2c-oled.schem", "lm7805-supply.schem", "nano-bme280.schem"]) {
    it(`examples/${file} compiles, lays out valid, passes layers 1-2, and draws deterministically`, () => {
      const source = readFileSync(join(ROOT, "examples", file), "utf8");
      const svg = drawAndVerify(source);
      expect(svg.startsWith("<svg ")).toBe(true);
    });
  }
});
