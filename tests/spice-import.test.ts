import { describe, expect, it } from "vitest";
import { compileDsl } from "../src/core/dsl.js";
import { formatDsl } from "../src/core/dsl-format.js";
import { importSpice } from "../src/io/spice.js";
import { layout } from "../src/layout/layout.js";
import { checkDrawing } from "../src/quality/index.js";
import { toSvg } from "../src/render/svg.js";

const RC_LOWPASS = `RC Low-Pass Filter
* First-order RC low-pass filter
V1 in 0 SIN(0 1 1k) ; 1 V peak sine wave at 1 kHz
R1 in out 1k
C1 out 0 100n
.ac dec 20 10 100k
.end
`;

const VOLTAGE_DIVIDER = `Voltage Divider
VBAT 5V 0 DC 5V
R1 5V mid 10k
R2 mid gnd 10k
.op
.end
`;

const CE_AMPLIFIER = `Common-Emitter BJT Amplifier
* Classic voltage-divider biased common-emitter stage
Vcc VCC 0 DC 12V
Vin in 0 AC 10m
Cin in base 10u
R1 VCC base 47k
R2 base 0 10k
Q1 col base emit 2N2222
Rc VCC col 2.2k
Re emit 0 470
Cout col out 10u
Rl out 0 10k
.model 2N2222 NPN(Is=14.34f Bf=255.9 Vaf=74.03)
.tran 10u 5m
.end
`;

const CMOS_INVERTER = `CMOS Inverter
* Standard complementary MOSFET inverter
Vdd VDD 0 DC 3.3V
Vin in 0 PULSE(0 3.3 0 1n 1n 5u 10u)
M1 out in VDD VDD PMOD W=2u L=180n
M2 out in 0 0 NMOD W=1u L=180n
Cload out 0 10p
.model PMOD PMOS(Level=1 Vto=-0.7 Kp=50u)
.model NMOD NMOS(Level=1 Vto=0.7 Kp=120u)
.tran 1n 20u
.end
`;

const DIODE_CLAMP_RECTIFIER = `Schottky Rectifier and Zener Clamp
Vac in 0 AC 12
D1 in vrect 1N5819
R1 vrect vout 470
D2 0 vout BZX84C5V1
C1 vout 0 47u
R2 vout led_a 330
D3 led_a 0 LED_RED
.model 1N5819 D(Is=31.7u Rs=0.05)
.model BZX84C5V1 D(BV=5.1)
.model LED_RED D(Is=1e-20 N=2)
.tran 100u 20m
.end
`;

const SUBCKT_IC = `LDO Voltage Regulator Circuit
* Subcircuit defined in the same file with named pins
.subckt REG3V3 VIN GND VOUT
Rint VIN VOUT 10
Cint VOUT GND 1u
.ends REG3V3

V1 5V 0 5V
Cin 5V 0 10u
X1 5V 0 3V3 REG3V3
Cout 3V3 0 10u
Rload 3V3 0 100
.op
.end
`;

const OPAMP_INVERTING = `Inverting Op-Amp Stage
.subckt IDEAL_OPAMP in+ in- out
Rdiff in+ in- 1Meg
.ends

Vin in 0 AC 1
Rin in inv 10k
Rf inv out 100k
X1 0 inv out IDEAL_OPAMP
Rload out 0 10k
.ac dec 10 10 100k
.end
`;

const REALISTIC_CASES: Array<[string, string]> = [
  ["RC low-pass filter", RC_LOWPASS],
  ["voltage divider", VOLTAGE_DIVIDER],
  ["common-emitter BJT amplifier", CE_AMPLIFIER],
  ["CMOS inverter", CMOS_INVERTER],
  ["diode rectifier and zener clamp", DIODE_CLAMP_RECTIFIER],
  ["subcircuit IC with .subckt pin names", SUBCKT_IC],
  ["inverting op-amp stage", OPAMP_INVERTING],
];

describe("importSpice realistic circuits", () => {
  for (const [label, source] of REALISTIC_CASES) {
    it(`imports, lays out, verifies, formats DSL, and renders deterministically: ${label}`, () => {
      const res = importSpice(source);
      expect(res.ok, res.errors.join("; ")).toBe(true);
      expect(res.errors).toEqual([]);
      expect(res.project).toBeDefined();
      expect(res.dsl).toBeDefined();

      const project = res.project!;
      const formatted = formatDsl(project);
      expect(formatted.ok).toBe(true);
      if (formatted.ok) {
        expect(formatted.source).toBe(res.dsl);
        const recompiled = compileDsl(formatted.source);
        expect(recompiled.ok, recompiled.errors.map((e) => e.message).join("; ")).toBe(true);
      }

      const laid = layout(project);
      expect(laid.status, laid.issues.join("; ")).toBe("valid");
      expect(laid.render).toBeDefined();

      const check = checkDrawing(project.circuit, laid.pinDefs, laid.render!);
      expect(check.connections.errors).toEqual([]);
      expect(check.overlaps).toEqual([]);
      expect(check.valid).toBe(true);

      const svg1 = toSvg(laid.render!);
      const svg2 = toSvg(layout(project).render!);
      expect(svg2).toBe(svg1);
    });
  }
});

describe("importSpice element mapping and syntax details", () => {
  it("maps RC filter elements, title, AC source, and GND net accurately", () => {
    const res = importSpice(RC_LOWPASS);
    expect(res.ok).toBe(true);
    const p = res.project!;
    expect(p.meta.title).toBe("RC Low-Pass Filter");
    expect(p.circuit.parts.map((x) => [x.id, x.type])).toEqual([
      ["V1", "ac-source"],
      ["R1", "resistor"],
      ["C1", "capacitor"],
    ]);
    expect(p.circuit.parts[0]!.props?.value).toBe("1V");
    expect(p.circuit.parts[0]!.props?.freq).toBe("1kHz");
    const gnd = p.circuit.nets.find((n) => n.name === "GND");
    expect(gnd?.kind).toBe("ground");
    expect(gnd?.endpoints).toEqual(["C1[2]", "V1[2]"]);
    expect(res.warnings.some((w) => w.includes(".ac"))).toBe(true);
  });

  it("maps battery-style DC voltage source and merges 0/gnd into GND", () => {
    const res = importSpice(VOLTAGE_DIVIDER);
    expect(res.ok).toBe(true);
    const p = res.project!;
    const bat = p.circuit.parts.find((x) => x.id === "VBAT");
    expect(bat?.type).toBe("battery");
    expect(bat?.props?.value).toBe("5V");
    const rail = p.circuit.nets.find((n) => n.name === "5V");
    expect(rail?.kind).toBe("power");
    const gnd = p.circuit.nets.find((n) => n.name === "GND");
    expect(gnd?.kind).toBe("ground");
    expect(gnd?.endpoints).toEqual(["R2[2]", "VBAT[-]"]);
  });

  it("detects NPN and PNP BJTs from .model directives placed after the elements", () => {
    const sp = `Complementary BJT Pair
Vcc VCC 0 12V
Q1 VCC in out 2N2222
Q2 0 in out 2N2907
Rload out 0 1k
Vin in 0 AC 1
.model 2N2222 NPN(Bf=200)
.model 2N2907 PNP(Bf=150)
.end
`;
    const res = importSpice(sp);
    expect(res.ok).toBe(true);
    const q1 = res.project!.circuit.parts.find((p) => p.id === "Q1");
    const q2 = res.project!.circuit.parts.find((p) => p.id === "Q2");
    expect(q1?.type).toBe("npn");
    expect(q1?.props?.partNumber).toBe("2N2222");
    expect(q2?.type).toBe("pnp");
    expect(q2?.props?.partNumber).toBe("2N2907");
    expect(layout(res.project!).status).toBe("valid");
  });

  it("detects PMOS and NMOS from .model and model names", () => {
    const res = importSpice(CMOS_INVERTER);
    expect(res.ok).toBe(true);
    const m1 = res.project!.circuit.parts.find((p) => p.id === "M1");
    const m2 = res.project!.circuit.parts.find((p) => p.id === "M2");
    expect(m1?.type).toBe("pmos");
    expect(m1?.props?.partNumber).toBe("PMOD");
    expect(m2?.type).toBe("nmos");
    expect(m2?.props?.partNumber).toBe("NMOD");
  });

  it("classifies schottky, zener, led, and standard diodes while keeping partNumber", () => {
    const res = importSpice(DIODE_CLAMP_RECTIFIER);
    expect(res.ok).toBe(true);
    const byId = new Map(res.project!.circuit.parts.map((p) => [p.id, p]));
    expect(byId.get("D1")?.type).toBe("schottky");
    expect(byId.get("D1")?.props?.partNumber).toBe("1N5819");
    expect(byId.get("D2")?.type).toBe("zener");
    expect(byId.get("D2")?.props?.partNumber).toBe("BZX84C5V1");
    expect(byId.get("D3")?.type).toBe("led");
    expect(byId.get("D3")?.props?.partNumber).toBe("LED_RED");
  });

  it("uses .subckt pin names for generic IC boxes and ignores internal subckt elements", () => {
    const res = importSpice(SUBCKT_IC);
    expect(res.ok).toBe(true);
    const ids = res.project!.circuit.parts.map((p) => p.id);
    expect(ids).not.toContain("Rint");
    expect(ids).not.toContain("Cint");
    const x1 = res.project!.circuit.parts.find((p) => p.id === "X1");
    expect(x1?.type).toBe("ic");
    expect(x1?.props?.partNumber).toBe("REG3V3");
    expect(x1?.pins).toEqual([
      { number: "1", name: "VIN", role: "power_in" },
      { number: "2", name: "GND", role: "ground" },
      { number: "3", name: "VOUT", role: "power_out" },
    ]);
  });

  it("maps 3-pin op-amp subckt to opamp and 5-pin LM741 to a 5-pin ic", () => {
    const res3 = importSpice(OPAMP_INVERTING);
    expect(res3.ok).toBe(true);
    const u1 = res3.project!.circuit.parts.find((p) => p.id === "X1");
    expect(u1?.type).toBe("opamp");
    expect(u1?.props?.partNumber).toBe("IDEAL_OPAMP");

    const sp5 = `Op-Amp with Split Rails
Vpos VCC 0 12V
Vneg VEE 0 -12V
Vin in 0 AC 1
R1 in inv 10k
Rf inv out 100k
X1 0 inv VCC VEE out LM741
Rload out 0 10k
.end
`;
    const res5 = importSpice(sp5);
    expect(res5.ok).toBe(true);
    const x1 = res5.project!.circuit.parts.find((p) => p.id === "X1");
    expect(x1?.type).toBe("ic");
    expect(x1?.pins?.map((p) => p.name)).toEqual(["IN+", "IN-", "V+", "V-", "OUT"]);
    const laid = layout(res5.project!);
    expect(laid.status).toBe("valid");
    expect(checkDrawing(res5.project!.circuit, laid.pinDefs, laid.render!).valid).toBe(true);
  });

  it("handles + line continuations, * and ; comments, .title, .control blocks, and trailing text after .end", () => {
    const sp = `* Leading comment line
.title RLC Bandpass Filter
V1 in 0
* comment inside continuation
+ SIN(0 2 10k) ; inline comment
L1 in mid
+ 10mH ; inductor value on continuation line
C1 mid out 100NF
R1 out 0 1e3
.control
tran 1u 1m
plot v(out)
.endc
.options reltol=1e-4
.end
R999 ignored 0 999k
`;
    const res = importSpice(sp);
    expect(res.ok, res.errors.join("; ")).toBe(true);
    const p = res.project!;
    expect(p.meta.title).toBe("RLC Bandpass Filter");
    expect(p.circuit.parts.map((x) => x.id)).toEqual(["V1", "L1", "C1", "R1"]);
    expect(p.circuit.parts.find((x) => x.id === "L1")?.type).toBe("inductor");
    expect(p.circuit.parts.find((x) => x.id === "L1")?.props?.value).toBe("10mH");
    expect(p.circuit.parts.find((x) => x.id === "C1")?.props?.value).toBe("100nF");
    expect(p.circuit.parts.find((x) => x.id === "R1")?.props?.value).toBe("1k");
    expect(layout(p).status).toBe("valid");
  });

  it("handles current source dynamically and maps SPICE current direction to current-source pins", () => {
    const sp = `Current Source Load
I1 0 out 1mA
R1 out 0 10k
.end
`;
    const res = importSpice(sp);
    expect(res.ok, res.errors.join("; ")).toBe(true);
    const p = res.project!;
    const srcPart = p.circuit.parts.find((x) => x.id === "I1");
    expect(srcPart).toBeDefined();
    expect(srcPart?.type).toBe("current-source");
    expect(p.circuit.nets.find((n) => n.name === "out")?.endpoints).toContain("I1[+]");
    expect(p.circuit.nets.find((n) => n.name === "GND")?.endpoints).toContain("I1[-]");
    const laid = layout(p);
    expect(laid.status).toBe("valid");
    expect(checkDrawing(p.circuit, laid.pinDefs, laid.render!).valid).toBe(true);
  });

  it("produces deterministic canonical net ordering regardless of card order", () => {
    const a = `Order Test
R1 VCC mid 10k
R2 mid 0 10k
V1 VCC 0 5V
.end
`;
    const b = `Order Test
V1 VCC 0 5V
R2 mid 0 10k
R1 VCC mid 10k
.end
`;
    const ra = importSpice(a);
    const rb = importSpice(b);
    expect(ra.ok && rb.ok).toBe(true);
    expect(ra.project!.circuit.nets).toEqual(rb.project!.circuit.nets);
    expect(ra.dsl).toBe(rb.dsl);
    // Power net first, then GND, then signal net
    expect(ra.project!.circuit.nets.map((n) => n.name)).toEqual(["VCC", "GND", "mid"]);
  });

  it("handles ambiguous BJT polarity, separate MOSFET bulk, and unsupported elements with warnings", () => {
    const sp = `Warnings Test
Vcc VCC 0 5V
Q1 VCC in out MY_UNKNOWN_BJT
M1 out in 0 vss NMOD
E1 buf 0 out 0 1
R1 out 0 1k
R2 in 0 10k
R3 vss 0 100
.model NMOD NMOS
.end
`;
    const res = importSpice(sp);
    expect(res.ok, res.errors.join("; ")).toBe(true);
    expect(res.warnings.some((w) => w.includes("MY_UNKNOWN_BJT") && w.includes("defaulting to npn"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("bulk node"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("E1") && w.includes("unsupported"))).toBe(true);
  });

  it("handles 3-pin opamp by model name, bare diodes, 3-node MOSFETs, 4-node BJTs, and sanitized node names", () => {
    const sp = `Mixed Edge Cases
Vin in 0 DC 0 AC 1
R1 in $N_0001 10k
D1 $N_0001 out
X1 0 $N_0001 out TL072
M1 out $N_0001 0 NMOS
Q1 out $N_0001 0 sub 2N2222
R2 sub 0 100k
.model 2N2222 NPN
.end
`;
    const res = importSpice(sp);
    expect(res.ok, res.errors.join("; ")).toBe(true);
    const byId = new Map(res.project!.circuit.parts.map((p) => [p.id, p]));
    expect(byId.get("Vin")?.type).toBe("ac-source");
    expect(byId.get("Vin")?.props?.value).toBe("1V");
    expect(byId.get("D1")?.type).toBe("diode");
    expect(byId.get("D1")?.props).toBeUndefined();
    expect(byId.get("X1")?.type).toBe("opamp");
    expect(byId.get("M1")?.type).toBe("nmos");
    expect(byId.get("Q1")?.type).toBe("npn");
    expect(res.warnings.some((w) => w.includes("substrate node"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("$N_0001"))).toBe(true);
    expect(formatDsl(res.project!).ok).toBe(true);
  });

  it("returns errors for empty input, missing elements, malformed cards, and duplicate IDs", () => {
    expect(importSpice("").ok).toBe(false);
    expect(importSpice("* only comments\n.op\n.end\n").ok).toBe(false);

    const badResistor = importSpice("Bad R\nR1 only_one_node\n.end\n");
    expect(badResistor.ok).toBe(false);
    expect(badResistor.errors.some((e) => e.includes("R1"))).toBe(true);

    const dupIds = importSpice("Dup IDs\nR1 a 0 1k\nr1 a 0 2k\n.end\n");
    expect(dupIds.ok).toBe(false);
    expect(dupIds.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });
});
