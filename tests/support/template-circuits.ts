// Small circuits, one per pattern template (SPEC 9.4), for tests/templates.test.ts and for
// looking at the drawings (scripts/templates.ts). Written from the SPEC 9.4 table, not from
// the layout code.

import type { Project } from "../../src/layout/layout.js";

const ic = (id: string, label: string, pins: Array<[string, string, string, string[]?]>, props: Record<string, string> = {}) => ({
  id, type: "ic", props: { label, ...props },
  pins: pins.map(([number, name, role, iface]) => ({ number, name, role: role as "bidir", ...(iface ? { iface } : {}) })),
});

/** Non-inverting amplifier: gain 1 + Rf/Rg, driven by a source, with a load. */
export const NONINVERTING: Project = {
  meta: { title: "Non-inverting amplifier" },
  circuit: {
    parts: [
      { id: "V1", type: "vsource", props: { value: "0.5V" } },
      { id: "U1", type: "opamp" },
      { id: "Rf", type: "resistor", props: { value: "47k" } },
      { id: "Rg", type: "resistor", props: { value: "10k" } },
      { id: "RL", type: "resistor", props: { value: "10k" } },
    ],
    nets: [
      { id: "n1", name: "IN", endpoints: ["V1.+", "U1.IN+"] },
      { id: "n2", name: "FB", endpoints: ["U1.IN-", "Rf.1", "Rg.1"] },
      { id: "n3", name: "OUT", endpoints: ["U1.OUT", "Rf.2", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["V1.-", "Rg.2", "RL.2"] },
    ],
  },
};

/** Inverting amplifier with one input (the classic drawing: input in line with IN-). */
export const INVERTING: Project = {
  meta: { title: "Inverting amplifier" },
  circuit: {
    parts: [
      { id: "V1", type: "vsource", props: { value: "1V" } },
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "R2", type: "resistor", props: { value: "100k" } },
      { id: "U1", type: "opamp" },
      { id: "RL", type: "resistor", props: { value: "2k2" } },
    ],
    nets: [
      { id: "n1", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "U1.IN-", "R2.1"] },
      { id: "n3", name: "OUT", endpoints: ["U1.OUT", "R2.2", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["V1.-", "U1.IN+", "RL.2"] },
    ],
  },
};

/** Voltage divider from a 5 V rail feeding a microcontroller's ADC input. */
export const DIVIDER: Project = {
  meta: { title: "Voltage divider" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "VCC", "power_in"], ["2", "GND", "ground"], ["3", "ADC0", "input"]]),
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "R2", type: "resistor", props: { value: "4.7k" } },
    ],
    nets: [
      { id: "n1", name: "5V", endpoints: ["U1.VCC", "R1.1"] },
      { id: "n2", name: "VSENSE", endpoints: ["R1.2", "R2.1", "U1.ADC0"] },
      { id: "n3", name: "GND", endpoints: ["U1.GND", "R2.2"] },
    ],
  },
};

/** A reset line pulled up to 3V3, shared by a controller and a peripheral; an enable line pulled down. */
export const PULLS: Project = {
  meta: { title: "Pull-up and pull-down" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "VDD", "power_in"], ["2", "GND", "ground"], ["3", "RST", "output"], ["4", "EN", "output"]], { controller: "true" }),
      ic("U2", "SENSOR", [["1", "VDD", "power_in"], ["2", "GND", "ground"], ["3", "NRST", "input"], ["4", "EN", "input"]]),
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "R2", type: "resistor", props: { value: "100k" } },
    ],
    nets: [
      { id: "n1", name: "3V3", endpoints: ["U1.VDD", "U2.VDD", "R1.1"] },
      { id: "n2", name: "GND", endpoints: ["U1.GND", "U2.GND", "R2.2"] },
      { id: "n3", name: "RST", endpoints: ["U1.RST", "U2.NRST", "R1.2"] },
      { id: "n4", name: "EN", endpoints: ["U1.EN", "U2.EN", "R2.1"] },
    ],
  },
};

/** A status LED on a GPIO: resistor first, LED to ground (with the MCU's decoupling capacitor). */
export const LED_GPIO: Project = {
  meta: { title: "Status LED" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "VDD", "power_in"], ["2", "GND", "ground"], ["3", "GPIO2", "output"]], { controller: "true" }),
      { id: "C1", type: "capacitor", props: { value: "100n" } },
      { id: "R1", type: "resistor", props: { value: "330" } },
      { id: "D1", type: "led", props: { color: "green" } },
    ],
    nets: [
      { id: "n1", name: "3V3", endpoints: ["U1.VDD", "C1.1"] },
      { id: "n2", name: "GND", endpoints: ["U1.GND", "D1.cathode", "C1.2"] },
      { id: "n3", endpoints: ["U1.GPIO2", "R1.1"] },
      { id: "n4", endpoints: ["R1.2", "D1.anode"] },
    ],
  },
};

/** An LED sunk by a driver pin: resistor first from the rail, in line, LED cathode into the driver. */
export const LED_SINK: Project = {
  meta: { title: "LED sunk by a driver" },
  circuit: {
    parts: [
      ic("U1", "DRIVER", [["2", "GND", "ground"], ["3", "OUT1", "input"]]),
      { id: "R1", type: "resistor", props: { value: "220" } },
      { id: "D1", type: "led", props: { color: "red" } },
      { id: "V1", type: "vsource", props: { value: "5V" } },
    ],
    nets: [
      { id: "n1", name: "VLED", kind: "signal", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "D1.anode"] },
      { id: "n3", name: "SINK", endpoints: ["D1.cathode", "U1.OUT1"] },
      { id: "n4", name: "GND", endpoints: ["U1.GND", "V1.-"] },
    ],
  },
};

/** Full-wave bridge rectifier from an AC source, with a smoothing capacitor and a load. */
export const BRIDGE: Project = {
  meta: { title: "Bridge rectifier" },
  circuit: {
    parts: [
      { id: "V1", type: "ac-source", props: { value: "12V" } },
      { id: "D1", type: "diode", props: { partNumber: "1N4007" } },
      { id: "D2", type: "diode", props: { partNumber: "1N4007" } },
      { id: "D3", type: "diode", props: { partNumber: "1N4007" } },
      { id: "D4", type: "diode", props: { partNumber: "1N4007" } },
      { id: "C1", type: "polarised-capacitor", props: { value: "1000u" } },
      { id: "RL", type: "resistor", props: { value: "1k" } },
    ],
    nets: [
      { id: "n1", name: "AC1", endpoints: ["V1.1", "D1[A]", "D3[K]"] },
      { id: "n2", name: "AC2", endpoints: ["V1.2", "D2[A]", "D4[K]"] },
      { id: "n3", name: "VDC", kind: "signal", endpoints: ["D1[K]", "D2[K]", "C1.+", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["D3[A]", "D4[A]", "C1.-", "RL.2"] },
    ],
  },
};

/** A motor driven both ways by a BJT H-bridge (PNP high side, NPN low side), each base through a resistor. */
export const HBRIDGE_BJT: Project = {
  meta: { title: "BJT H-bridge" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "GND", "ground"], ["2", "IN1", "output"], ["3", "IN2", "output"], ["4", "IN3", "output"], ["5", "IN4", "output"]], { controller: "true" }),
      { id: "R1", type: "resistor", props: { value: "1k" } },
      { id: "R2", type: "resistor", props: { value: "1k" } },
      { id: "R3", type: "resistor", props: { value: "1k" } },
      { id: "R4", type: "resistor", props: { value: "1k" } },
      { id: "Q1", type: "pnp", props: { partNumber: "TIP125" } },
      { id: "Q2", type: "npn", props: { partNumber: "TIP120" } },
      { id: "Q3", type: "pnp", props: { partNumber: "TIP125" } },
      { id: "Q4", type: "npn", props: { partNumber: "TIP120" } },
      { id: "M1", type: "motor", props: { label: "6 V motor" } },
      { id: "B1", type: "battery", props: { value: "6V" } },
    ],
    nets: [
      { id: "n1", name: "6V", endpoints: ["B1.+", "Q1[E]", "Q3[E]"] },
      { id: "n2", name: "GND", endpoints: ["B1.-", "Q2[E]", "Q4[E]", "U1.GND"] },
      { id: "n3", name: "OUTA", endpoints: ["Q1[C]", "Q2[C]", "M1.1"] },
      { id: "n4", name: "OUTB", endpoints: ["Q3[C]", "Q4[C]", "M1.2"] },
      { id: "n5", endpoints: ["U1.IN1", "R1.1"] },
      { id: "n6", endpoints: ["U1.IN2", "R2.1"] },
      { id: "n7", endpoints: ["U1.IN3", "R3.1"] },
      { id: "n8", endpoints: ["U1.IN4", "R4.1"] },
      { id: "n9", endpoints: ["R1.2", "Q1[B]"] },
      { id: "n10", endpoints: ["R2.2", "Q2[B]"] },
      { id: "n11", endpoints: ["R3.2", "Q3[B]"] },
      { id: "n12", endpoints: ["R4.2", "Q4[B]"] },
    ],
  },
};

/** A motor switched on its low side by an NPN transistor from a GPIO, with a flyback diode across the motor. */
export const LOW_SIDE: Project = {
  meta: { title: "Low-side motor switch" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "GND", "ground"], ["2", "PWM", "output"]], { controller: "true" }),
      { id: "R1", type: "resistor", props: { value: "1k" } },
      { id: "Q1", type: "npn", props: { partNumber: "2N2222A" } },
      { id: "M1", type: "motor", props: { label: "12 V fan" } },
      { id: "D1", type: "diode", props: { partNumber: "1N4001" } },
      { id: "B1", type: "battery", props: { value: "12V" } },
    ],
    nets: [
      { id: "n1", name: "12V", endpoints: ["B1.+", "M1.1", "D1[K]"] },
      { id: "n2", endpoints: ["M1.2", "D1[A]", "Q1[C]"] },
      { id: "n3", name: "GND", endpoints: ["B1.-", "Q1[E]", "U1.GND"] },
      { id: "n4", endpoints: ["U1.PWM", "R1.1"] },
      { id: "n5", endpoints: ["R1.2", "Q1[B]"] },
    ],
  },
};

/**
 * MOSFET differential pair with a current-mirror load and a resistor tail, both inputs driven,
 * on a single supply (the input stage of a simple op-amp).
 */
export const DIFF_PAIR: Project = {
  meta: { title: "MOSFET differential pair" },
  circuit: {
    parts: [
      { id: "B1", type: "battery", props: { value: "5V" } },
      { id: "V1", type: "vsource", props: { value: "2.5V" } },
      { id: "V2", type: "vsource", props: { value: "2.5V" } },
      { id: "Q1", type: "nmos", props: { partNumber: "2N7000" } },
      { id: "Q2", type: "nmos", props: { partNumber: "2N7000" } },
      { id: "Q3", type: "pmos", props: { partNumber: "BS250" } },
      { id: "Q4", type: "pmos", props: { partNumber: "BS250" } },
      { id: "RT", type: "resistor", props: { value: "4.7k" } },
      { id: "RL", type: "resistor", props: { value: "47k" } },
    ],
    nets: [
      { id: "n1", name: "VDD", endpoints: ["B1.+", "Q3[S]", "Q4[S]"] },
      { id: "n2", name: "GND", endpoints: ["B1.-", "V1.-", "V2.-", "RT.2", "RL.2"] },
      { id: "n3", name: "INP", endpoints: ["V1.+", "Q1[G]"] },
      { id: "n4", name: "INN", endpoints: ["V2.+", "Q2[G]"] },
      { id: "n5", endpoints: ["Q1[D]", "Q3[D]", "Q3[G]", "Q4[G]"] },
      { id: "n6", name: "OUT", endpoints: ["Q2[D]", "Q4[D]", "RL.1"] },
      { id: "n7", endpoints: ["Q1[S]", "Q2[S]", "RT.1"] },
    ],
  },
};

/** I2C bus to an EEPROM whose supply pin has two decoupling capacitors (the SPEC 9.2 child slot). */
export const I2C_DECOUPLED: Project = {
  meta: { title: "I2C EEPROM with decoupling" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "VCC", "power_in"], ["2", "GND", "ground"], ["3", "SDA", "bidir", ["i2c.sda"]], ["4", "SCL", "bidir", ["i2c.scl"]]], { controller: "true" }),
      ic("U2", "EEPROM", [["1", "A0", "input"], ["4", "VSS", "ground"], ["5", "SDA", "bidir", ["i2c.sda"]], ["6", "SCL", "bidir", ["i2c.scl"]], ["8", "VCC", "power_in"]]),
      { id: "R1", type: "resistor", props: { value: "4.7k" } },
      { id: "R2", type: "resistor", props: { value: "4.7k" } },
      { id: "C1", type: "capacitor", props: { value: "100n" } },
      { id: "C2", type: "capacitor", props: { value: "10u" } },
    ],
    nets: [
      { id: "n1", name: "3V3", endpoints: ["U1.VCC", "U2.VCC", "R1.1", "R2.1", "C1.1", "C2.1"] },
      { id: "n2", name: "GND", endpoints: ["U1.GND", "U2.VSS", "U2.A0", "C1.2", "C2.2"] },
      { id: "n3", name: "SDA", endpoints: ["U1.SDA", "U2.SDA", "R1.2"] },
      { id: "n4", name: "SCL", endpoints: ["U1.SCL", "U2.SCL", "R2.2"] },
    ],
  },
  // Both chips are on 3V3, so the capacitors name the pin they serve.
  intent: { hints: [
    { id: "h1", type: "decouples", part: "C1", pin: "U2[8]", priority: "normal" },
    { id: "h2", type: "decouples", part: "C2", pin: "U2[8]", priority: "normal" },
  ] },
};

/**
 * I2C bus from a controller whose reset pin, above the bus pins, has an RC network (pull-up and
 * capacitor to ground): the RC sits in a column the bus crosses, so it must keep clear of the bus.
 */
export const I2C_RESET_RC: Project = {
  meta: { title: "I2C with a reset RC" },
  circuit: {
    parts: [
      ic("U1", "MCU", [["1", "PWM", "output"], ["2", "VCC", "power_in"], ["3", "SDA", "bidir", ["i2c.sda"]], ["4", "SCL", "bidir", ["i2c.scl"]], ["5", "GND", "ground"]], { controller: "true" }),
      ic("U2", "SENSOR", [["1", "VDD", "power_in"], ["2", "GND", "ground"], ["3", "SDA", "bidir", ["i2c.sda"]], ["4", "SCL", "bidir", ["i2c.scl"]]]),
      { id: "R1", type: "resistor", props: { value: "10k" } },
      { id: "C1", type: "capacitor", props: { value: "100n" } },
      { id: "R2", type: "resistor", props: { value: "4.7k" } },
      { id: "R3", type: "resistor", props: { value: "4.7k" } },
    ],
    nets: [
      { id: "n1", name: "3V3", endpoints: ["U1.VCC", "U2.VDD", "R1.1", "R2.1", "R3.1"] },
      { id: "n2", name: "GND", endpoints: ["U1.GND", "U2.GND", "C1.2"] },
      { id: "n3", name: "FILT", endpoints: ["U1.PWM", "R1.2", "C1.1"] },
      { id: "n4", name: "SDA", endpoints: ["U1.SDA", "U2.SDA", "R2.2"] },
      { id: "n5", name: "SCL", endpoints: ["U1.SCL", "U2.SCL", "R3.2"] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Active filters and oscillators around one op-amp.

const R = (id: string, value: string) => ({ id, type: "resistor", props: { value } });
const C = (id: string, value: string) => ({ id, type: "capacitor", props: { value } });

/** Sallen-Key low-pass, unity gain: two series resistors into IN+, C1 back from the output, C2 to ground. */
export const SALLEN_KEY_LOWPASS: Project = {
  meta: { title: "Sallen-Key low-pass filter" },
  circuit: {
    parts: [{ id: "V1", type: "vsource", props: { value: "1V" } }, R("R1", "10k"), R("R2", "10k"), C("C1", "22n"), C("C2", "10n"), { id: "U1", type: "opamp" }, R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "R2.1", "C1.1"] },
      { id: "n3", endpoints: ["R2.2", "C2.1", "U1.IN+"] },
      { id: "n4", name: "OUT", endpoints: ["U1.OUT", "U1.IN-", "C1.2", "RL.1"] },
      { id: "n5", name: "GND", endpoints: ["V1.-", "C2.2", "RL.2"] },
    ],
  },
};

/** Sallen-Key high-pass with gain: series capacitors, R1 back from the output, R2 to ground, gain 1 + R3/R4. */
export const SALLEN_KEY_HIGHPASS_GAIN: Project = {
  meta: { title: "Sallen-Key high-pass filter with gain" },
  circuit: {
    parts: [{ id: "V1", type: "vsource", props: { value: "1V" } }, C("C1", "10n"), C("C2", "10n"), R("R1", "11k"), R("R2", "22k"), { id: "U1", type: "opamp" }, R("R3", "5k6"), R("R4", "10k"), R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["V1.+", "C1.1"] },
      { id: "n2", endpoints: ["C1.2", "C2.1", "R1.1"] },
      { id: "n3", endpoints: ["C2.2", "R2.1", "U1.IN+"] },
      { id: "n4", name: "OUT", endpoints: ["U1.OUT", "R3.1", "R1.2", "RL.1"] },
      { id: "n5", endpoints: ["U1.IN-", "R3.2", "R4.1"] },
      { id: "n6", name: "GND", endpoints: ["V1.-", "R2.2", "R4.2", "RL.2"] },
    ],
  },
};

/** Fourth-order low-pass: two Sallen-Key stages in a row, the second fed by the first one's output. */
export const SALLEN_KEY_TWO_STAGE: Project = {
  meta: { title: "Fourth-order low-pass filter" },
  circuit: {
    parts: [
      { id: "V1", type: "vsource", props: { value: "1V" } },
      R("R1", "10k"), R("R2", "10k"), C("C1", "22n"), C("C2", "10n"), { id: "U1", type: "opamp" },
      R("R3", "10k"), R("R4", "10k"), C("C3", "47n"), C("C4", "4n7"), { id: "U2", type: "opamp" },
      R("RL", "10k"),
    ],
    nets: [
      { id: "n1", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "R2.1", "C1.1"] },
      { id: "n3", endpoints: ["R2.2", "C2.1", "U1.IN+"] },
      { id: "n4", endpoints: ["U1.OUT", "U1.IN-", "C1.2", "R3.1"] },
      { id: "n5", endpoints: ["R3.2", "R4.1", "C3.1"] },
      { id: "n6", endpoints: ["R4.2", "C4.1", "U2.IN+"] },
      { id: "n7", name: "OUT", endpoints: ["U2.OUT", "U2.IN-", "C3.2", "RL.1"] },
      { id: "n8", name: "GND", endpoints: ["V1.-", "C2.2", "C4.2", "RL.2"] },
    ],
  },
};

/** Integrator: input resistor into IN-, capacitor from the output back to IN-. */
export const INTEGRATOR: Project = {
  meta: { title: "Integrator" },
  circuit: {
    parts: [{ id: "V1", type: "vsource", props: { value: "1V" } }, R("R1", "10k"), C("C1", "100n"), { id: "U1", type: "opamp" }, R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "C1.1", "U1.IN-"] },
      { id: "n3", name: "OUT", endpoints: ["U1.OUT", "C1.2", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["V1.-", "U1.IN+", "RL.2"] },
    ],
  },
};

/** Active low-pass: an inverting amplifier with a capacitor across its feedback resistor. */
export const ACTIVE_LOWPASS: Project = {
  meta: { title: "Active low-pass filter" },
  circuit: {
    parts: [{ id: "V1", type: "vsource", props: { value: "1V" } }, R("R1", "10k"), R("R2", "100k"), C("C1", "1n"), { id: "U1", type: "opamp" }, R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["V1.+", "R1.1"] },
      { id: "n2", endpoints: ["R1.2", "R2.1", "C1.1", "U1.IN-"] },
      { id: "n3", name: "OUT", endpoints: ["U1.OUT", "R2.2", "C1.2", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["V1.-", "U1.IN+", "RL.2"] },
    ],
  },
};

/** Relaxation oscillator: R3 and C1 set the period, R1 and R2 set the switching thresholds. */
export const RELAXATION_OSCILLATOR: Project = {
  meta: { title: "Relaxation oscillator" },
  circuit: {
    parts: [{ id: "U1", type: "opamp" }, R("R1", "100k"), R("R2", "100k"), R("R3", "47k"), C("C1", "10n"), R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["U1.IN+", "R1.1", "R2.1"] },
      { id: "n2", endpoints: ["U1.IN-", "R3.1", "C1.1"] },
      { id: "n3", name: "OUT", endpoints: ["U1.OUT", "R1.2", "R3.2", "RL.1"] },
      { id: "n4", name: "GND", endpoints: ["R2.2", "C1.2", "RL.2"] },
    ],
  },
};

/** Wien bridge oscillator: R1 and C1 in series from the output to IN+, R2 and C2 to ground, gain 1 + R3/R4. */
export const WIEN_BRIDGE: Project = {
  meta: { title: "Wien bridge oscillator" },
  circuit: {
    parts: [{ id: "U1", type: "opamp" }, R("R1", "10k"), C("C1", "16n"), R("R2", "10k"), C("C2", "16n"), R("R3", "20k"), R("R4", "10k"), R("RL", "10k")],
    nets: [
      { id: "n1", endpoints: ["R1.2", "C1.1"] },
      { id: "n2", endpoints: ["C1.2", "U1.IN+", "R2.1", "C2.1"] },
      { id: "n3", endpoints: ["U1.IN-", "R3.1", "R4.1"] },
      { id: "n4", name: "OUT", endpoints: ["U1.OUT", "R1.1", "R3.2", "RL.1"] },
      { id: "n5", name: "GND", endpoints: ["R2.2", "C2.2", "R4.2", "RL.2"] },
    ],
  },
};

export const TEMPLATE_CIRCUITS: Record<string, Project> = {
  "noninverting": NONINVERTING, "inverting": INVERTING, "divider": DIVIDER, "pulls": PULLS, "led-gpio": LED_GPIO, "led-sink": LED_SINK,
  "bridge": BRIDGE, "hbridge-bjt": HBRIDGE_BJT, "low-side": LOW_SIDE, "diff-pair": DIFF_PAIR, "i2c-decoupled": I2C_DECOUPLED, "i2c-reset-rc": I2C_RESET_RC,
  "sallen-key-lowpass": SALLEN_KEY_LOWPASS, "sallen-key-highpass-gain": SALLEN_KEY_HIGHPASS_GAIN, "sallen-key-two-stage": SALLEN_KEY_TWO_STAGE,
  "integrator": INTEGRATOR, "active-lowpass": ACTIVE_LOWPASS, "relaxation-oscillator": RELAXATION_OSCILLATOR, "wien-bridge": WIEN_BRIDGE,
};
