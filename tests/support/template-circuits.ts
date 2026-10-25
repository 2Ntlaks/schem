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

export const TEMPLATE_CIRCUITS: Record<string, Project> = {
  "noninverting": NONINVERTING, "inverting": INVERTING, "divider": DIVIDER, "pulls": PULLS, "led-gpio": LED_GPIO, "led-sink": LED_SINK,
  "bridge": BRIDGE, "hbridge-bjt": HBRIDGE_BJT, "low-side": LOW_SIDE,
};
