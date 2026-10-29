// One small, realistic circuit per Phase 0b symbol (SPEC 7.2). Used by tests/symbols.test.ts
// and drawn by scripts/symbols.ts to out/symbols/ for looking at.

import type { Project } from "../../src/layout/layout.js";
import type { Part } from "../../src/core/model.js";

const net = (id: string, name: string | undefined, ...endpoints: string[]) => (name === undefined ? { id, endpoints } : { id, name, endpoints });
/** A header; `input` marks it as where the signal comes in (SPEC 9.2 step 2 sources). */
const header = (id: string, label: string, names: string[], input = false): Part =>
  ({ id, type: "header", props: input ? { label, flow: "input" } : { label }, pins: names.map((n, i) => ({ number: String(i + 1), name: n, role: n === "GND" ? "ground" as const : "passive" as const })) });

export const SYMBOL_CIRCUITS: Record<string, { covers: string[]; project: Project }> = {
  "half-wave-rectifier": {
    covers: ["ac-source", "diode", "polarised-capacitor"],
    project: { meta: { title: "Half-wave rectifier" }, circuit: {
      parts: [
        { id: "V1", type: "ac-source", props: { value: "12V" } },
        { id: "D1", type: "diode", props: { partNumber: "1N4007" } },
        { id: "C1", type: "polarised-capacitor", props: { value: "470u" } },
        { id: "R1", type: "resistor", props: { value: "1k" } },
      ],
      nets: [
        net("n1", "AC", "V1[1]", "D1[A]"),
        net("n2", "VOUT", "D1[K]", "C1[+]", "R1[1]"),
        net("n3", "GND", "V1[2]", "C1[-]", "R1[2]"),
      ],
    } },
  },
  "npn-low-side-switch": {
    covers: ["npn", "header"],
    project: { meta: { title: "NPN low-side LED switch" }, circuit: {
      parts: [
        header("J1", "IN", ["IN", "GND"], true),
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "R1", type: "resistor", props: { value: "1k" } },
        { id: "R2", type: "resistor", props: { value: "470" } },
        { id: "D1", type: "led", props: { color: "red" } },
        { id: "Q1", type: "npn", props: { partNumber: "2N2222A" } },
      ],
      nets: [
        net("n1", "IN", "J1[1]", "R1[1]"),
        net("n2", undefined, "R1[2]", "Q1[B]"),
        net("n3", "9V", "B1[+]", "R2[1]"),
        net("n4", undefined, "R2[2]", "D1[A]"),
        net("n5", undefined, "D1[K]", "Q1[C]"),
        net("n6", "GND", "B1[-]", "Q1[E]", "J1[2]"),
      ],
    } },
  },
  "pnp-high-side-switch": {
    covers: ["pnp"],
    project: { meta: { title: "PNP high-side switch" }, circuit: {
      parts: [
        header("J1", "CTRL", ["CTRL", "GND"], true),
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "R1", type: "resistor", props: { value: "4.7k" } },
        { id: "R2", type: "resistor", props: { value: "47k" } },
        { id: "RL", type: "resistor", props: { value: "100" } },
        { id: "Q1", type: "pnp", props: { partNumber: "2N3906" } },
      ],
      nets: [
        net("n1", "9V", "B1[+]", "Q1[E]", "R2[1]"),
        net("n2", "BASE", "R1[2]", "Q1[B]", "R2[2]"),
        net("n3", "LOAD", "Q1[C]", "RL[1]"),
        net("n4", "GND", "B1[-]", "RL[2]", "J1[2]"),
        net("n5", "CTRL", "J1[1]", "R1[1]"),
      ],
    } },
  },
  "nmos-motor-driver": {
    covers: ["nmos", "motor", "fuse"],
    project: { meta: { title: "N-MOSFET motor driver" }, circuit: {
      parts: [
        header("J1", "PWM", ["PWM", "GND"], true),
        { id: "B1", type: "battery", props: { value: "12V" } },
        { id: "F1", type: "fuse", props: { value: "2A" } },
        { id: "M1", type: "motor", props: { label: "12 V" } },
        { id: "D1", type: "diode", props: { partNumber: "1N5819" } },
        { id: "R1", type: "resistor", props: { value: "100" } },
        { id: "R2", type: "resistor", props: { value: "10k" } },
        { id: "Q1", type: "nmos", props: { partNumber: "IRLZ44N" } },
      ],
      nets: [
        net("n1", "VBAT", "B1[+]", "F1[1]"),
        net("n2", "12V", "F1[2]", "M1[1]", "D1[K]"),
        net("n3", "DRAIN", "M1[2]", "D1[A]", "Q1[D]"),
        net("n4", "PWM", "J1[1]", "R1[1]"),
        net("n5", "GATE", "R1[2]", "Q1[G]", "R2[1]"),
        net("n6", "GND", "B1[-]", "Q1[S]", "R2[2]", "J1[2]"),
      ],
    } },
  },
  "pmos-high-side-switch": {
    covers: ["pmos"],
    project: { meta: { title: "P-MOSFET high-side switch" }, circuit: {
      parts: [
        header("J1", "EN", ["EN", "GND"], true),
        { id: "B1", type: "battery", props: { value: "12V" } },
        { id: "R1", type: "resistor", props: { value: "10k" } },
        { id: "R2", type: "resistor", props: { value: "1k" } },
        { id: "Q1", type: "pmos", props: { partNumber: "IRF9540N" } },
        { id: "D1", type: "led", props: { color: "green" } },
      ],
      nets: [
        net("n1", "12V", "B1[+]", "Q1[S]", "R1[1]"),
        net("n2", "GATE", "Q1[G]", "R1[2]", "J1[1]"),
        net("n3", "OUT", "Q1[D]", "R2[1]"),
        net("n4", undefined, "R2[2]", "D1[A]"),
        net("n5", "GND", "B1[-]", "D1[K]", "J1[2]"),
      ],
    } },
  },
  "potentiometer-dimmer": {
    covers: ["potentiometer"],
    project: { meta: { title: "Potentiometer as a voltage divider" }, circuit: {
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "RV1", type: "potentiometer", props: { value: "10k" } },
        { id: "R1", type: "resistor", props: { value: "330" } },
        { id: "D1", type: "led", props: { color: "yellow" } },
      ],
      nets: [
        net("n1", "9V", "B1[+]", "RV1[1]"),
        net("n2", "WIPER", "RV1[2]", "R1[1]"),
        net("n3", undefined, "R1[2]", "D1[A]"),
        net("n4", "GND", "B1[-]", "RV1[3]", "D1[K]"),
      ],
    } },
  },
  "spst-lamp-switch": {
    covers: ["spst"],
    project: { meta: { title: "Switched LED" }, circuit: {
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "SW1", type: "spst" },
        { id: "R1", type: "resistor", props: { value: "470" } },
        { id: "D1", type: "led", props: { color: "red" } },
      ],
      nets: [
        net("n1", "9V", "B1[+]", "SW1[1]"),
        net("n2", undefined, "SW1[2]", "R1[1]"),
        net("n3", undefined, "R1[2]", "D1[A]"),
        net("n4", "GND", "B1[-]", "D1[K]"),
      ],
    } },
  },
  "pushbutton-pull-up": {
    covers: ["pushbutton", "header"],
    project: { meta: { title: "Push button with pull-up" }, circuit: {
      parts: [
        header("J1", "MCU", ["5V", "BTN", "GND"], true),
        { id: "R1", type: "resistor", props: { value: "10k" } },
        { id: "SW1", type: "pushbutton" },
      ],
      nets: [
        net("n1", "5V", "J1[1]", "R1[1]"),
        net("n2", "BTN", "J1[2]", "R1[2]", "SW1[1]"),
        net("n3", "GND", "J1[3]", "SW1[2]"),
      ],
    } },
  },
  "buzzer-driver": {
    covers: ["buzzer", "npn"],
    project: { meta: { title: "Buzzer driven by an NPN" }, circuit: {
      parts: [
        header("J1", "MCU", ["BUZ", "GND"], true),
        { id: "R1", type: "resistor", props: { value: "1k" } },
        { id: "Q1", type: "npn", props: { partNumber: "BC547" } },
        { id: "BZ1", type: "buzzer", props: { label: "5 V" } },
        { id: "B1", type: "battery", props: { value: "5V" } },
      ],
      nets: [
        net("n1", "BUZ", "J1[1]", "R1[1]"),
        net("n2", undefined, "R1[2]", "Q1[B]"),
        net("n3", "5V", "B1[+]", "BZ1[+]"),
        net("n4", undefined, "BZ1[-]", "Q1[C]"),
        net("n5", "GND", "B1[-]", "Q1[E]", "J1[2]"),
      ],
    } },
  },
  "relay-driver": {
    covers: ["relay", "npn", "diode", "header"],
    project: { meta: { title: "Relay driver" }, circuit: {
      parts: [
        header("J1", "MCU", ["RELAY", "GND"], true),
        { id: "B1", type: "battery", props: { value: "5V" } },
        { id: "R1", type: "resistor", props: { value: "1k" } },
        { id: "Q1", type: "npn", props: { partNumber: "2N2222A" } },
        { id: "D1", type: "diode", props: { partNumber: "1N4148" } },
        { id: "K1", type: "relay", props: { label: "5 V relay" } },
        header("J2", "LOAD", ["COM", "NO", "NC"]),
      ],
      nets: [
        net("n1", "5V", "B1[+]", "D1[K]", "K1[A1]"),
        net("n2", "GND", "B1[-]", "Q1[E]", "J1[2]"),
        net("n3", "RELAY", "J1[1]", "R1[1]"),
        net("n4", undefined, "R1[2]", "Q1[B]"),
        net("n5", undefined, "D1[A]", "K1[A2]", "Q1[C]"),
        net("n6", undefined, "J2[1]", "K1[11]"),
        net("n7", undefined, "J2[2]", "K1[14]"),
        net("n8", undefined, "J2[3]", "K1[12]"),
      ],
    } },
  },
  "zener-shunt": {
    covers: ["zener", "schottky"],
    project: { meta: { title: "Zener shunt regulator" }, circuit: {
      parts: [
        { id: "B1", type: "battery", props: { value: "9V" } },
        { id: "R1", type: "resistor", props: { value: "220" } },
        { id: "D1", type: "zener", props: { value: "5.1V" } },
        { id: "D2", type: "schottky", props: { partNumber: "1N5817" } },
        { id: "R2", type: "resistor", props: { value: "1k" } },
      ],
      nets: [
        net("n1", "9V", "B1[+]", "R1[1]"),
        net("n2", "REG", "R1[2]", "D1[K]", "D2[A]"),
        net("n3", "LOAD", "D2[K]", "R2[1]"),
        net("n4", "GND", "B1[-]", "D1[A]", "R2[2]"),
      ],
    } },
  },
  "header-feeds-resistor": {
    covers: ["header"],
    project: { meta: { title: "Header feeding a resistor" }, circuit: {
      parts: [
        header("J1", "SENSOR", ["VCC", "OUT", "GND"], true),
        { id: "R1", type: "resistor", props: { value: "10k" } },
      ],
      nets: [
        net("n1", "VCC", "J1[1]", "R1[1]"),
        net("n2", "OUT", "J1[2]", "R1[2]"),
      ],
      nc: ["J1[3]"],
    } },
  },
};
