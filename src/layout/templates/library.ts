// The v1 pattern templates (SPEC 9.4) as data, in priority order. Each one is versioned; the
// versions of the templates a layout used are recorded with it (`LayoutState.templates`,
// part of `layout.basis`). Bump `version` whenever a template's data changes its output.
//
// Frames: constraints are difference constraints `a - b op c` between pin anchors, keep-out
// edges (`box`), envelope edges (`env`: keep-out plus label and port symbols) and guides.
// Grid units throughout; y grows downwards.

import type { Ref, Rel, Template } from "./types.js";

const pin = (slot: string, p: string | { net: string } | { iface: string }, agg?: "min" | "max"): Ref => ({ pin: [slot, p], ...(agg ? { agg } : {}) });
const env = (slot: string, edge: "left" | "right" | "top" | "bottom"): Ref => ({ env: [slot, edge] });
const guide = (name: string): Ref => ({ guide: name });
const net = (n: string) => ({ net: n });
const SDA = { iface: "i2c.sda" }, SCL = { iface: "i2c.scl" };
const rel = (axis: "x" | "y", a: Ref, op: Rel["op"], b: Ref, c: number, why: string, extra: Partial<Rel> = {}): Rel => ({ axis, a, op, b, c, why, ...extra });

/**
 * Op-amp inverting / summing amplifier (Appendix A.1). The summing node is one vertical
 * conductor at column S = IN-.x - 3, pre-routed; inputs come in from the left, each on its own
 * row; the feedback resistor runs above the op-amp from the node to the output tap column.
 */
const OPAMP_INVERTING: Template = {
  id: "opamp-inverting", version: 1, priority: 1,
  summary: "op-amp; resistor between OUT and IN-; at least one resistor into IN-",
  nets: { SUM: { kind: ["signal"] }, OUT: { kind: ["signal"] }, REF: {} },
  slots: [
    { name: "u", types: ["opamp"], role: "member", orient: { rot: 0, flip: false }, label: "below",
      pins: [{ pin: "IN-", net: "SUM" }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "REF" }] },
    { name: "rf", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
      pins: [{ pin: "1", net: "SUM" }, { pin: "2", net: "OUT" }] },
    { name: "rin", types: ["resistor"], role: "member", symmetric: true, many: { min: 1 }, orient: { net: "SUM", dir: "right" },
      pins: [{ pin: "1", net: "*", pred: { kind: ["signal"] } }, { pin: "2", net: "SUM" }] },
    // The source driving each input, when every input has one (Appendix A.1: staggered, "+" up).
    { name: "src", types: ["vsource", "battery"], role: "link", many: { min: 0 }, follow: { slot: "rin" }, pins: [] },
  ],
  interior: [
    // Columns: the node column S, the output tap column T.
    rel("x", guide("S"), "=", pin("u", "IN-"), -3, "node column S = IN-.x - 3 (clear of the IN+ symbol)"),
    rel("x", pin("rin", net("SUM")), "<=", guide("S"), -2, "inputs end at least 2 G left of the node"),
    rel("x", pin("rin", net("SUM")), "=", pin("rin", net("SUM")), 0, "inputs end in one column", { each: "chain" }),
    rel("x", env("rin", "right"), "<=", guide("S"), -1, "input labels clear of the node column"),
    rel("x", pin("rf", net("SUM")), ">=", guide("S"), 2, "feedback resistor starts 2 G right of the node"),
    rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
    rel("x", pin("rf", net("OUT")), "<=", guide("T"), -1, "feedback resistor ends left of the tap"),
    rel("x", env("rf", "right"), "<=", guide("T"), -1, "feedback label clear of the tap column"),
    // Rows.
    rel("y", pin("rin", net("SUM")), "=", pin("u", "IN-"), 0, "a single input is in line with IN-", { when: { slot: "rin", max: 1 } }),
    rel("y", pin("rin", net("SUM")), "=", pin("u", "IN-"), -2, "first input 2 G above IN-", { each: "first", when: { slot: "rin", min: 2 } }),
    rel("y", env("rin", "top"), ">=", pin("rin", net("SUM")), 2, "next input's label 2 G below the previous input's wire", { each: "chain", when: { slot: "rin", min: 2 } }),
    rel("y", env("rf", "bottom"), "<=", env("u", "top"), -1, "feedback resistor above the op-amp, 1 G corridor"),
  ],
  link: [
    // Sources stay stacked in their column; each one sits right of the one above, so its wire
    // runs straight up past it and turns once into its input (Appendix A.1: "+" up, one bend).
    rel("x", pin("src", net("*")), ">=", env("src", "right"), 1, "sources stepped right, in input order", { each: "chain" }),
  ],
  boundary: [["rin", { net: "*" }], ["u", "OUT"], ["u", "IN+"]],
  trunks: [{
    net: "SUM", why: "the summing node: one vertical conductor at S from the feedback row to the lowest input",
    points: [
      { x: guide("S"), y: pin("rf", net("SUM")) },
      { x: guide("S"), y: [pin("rin", net("SUM"), "max"), pin("u", "IN-")], agg: "max" },
    ],
  }, {
    net: "OUT", why: "the output line to the tap column, and up to the feedback resistor",
    points: [
      { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
      { x: guide("T"), y: pin("u", "OUT") },
      { x: guide("T"), y: pin("rf", net("OUT")) },
    ],
    require: [{ pin: ["u", "OUT"], dir: "right" }],
  }],
};

/**
 * Op-amp non-inverting amplifier. The op-amp is mirrored so IN+ is on top and the input comes in
 * straight from the left; the feedback network hangs below it: node column S left of IN-, the
 * feedback resistor horizontal below the op-amp, the ground resistor vertical below the node.
 */
const OPAMP_NONINVERTING: Template = {
  id: "opamp-noninverting", version: 1, priority: 2,
  summary: "op-amp; resistor OUT -> IN-; resistor IN- -> ground",
  nets: { FB: { kind: ["signal"] }, OUT: { kind: ["signal"] }, IN: {}, RAIL: { kind: ["ground"] } },
  slots: [
    { name: "u", types: ["opamp"], role: "member", orient: { rot: 180, flip: true },
      pins: [{ pin: "IN-", net: "FB" }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "IN" }] },
    { name: "rf", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
      pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "OUT" }] },
    { name: "rg", types: ["resistor"], role: "member", symmetric: true, orient: { net: "FB", dir: "up" },
      pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "RAIL" }] },
  ],
  interior: [
    rel("x", guide("S"), "=", pin("u", "IN-"), -2, "node column S = IN-.x - 2"),
    rel("x", pin("rg", net("FB")), "=", guide("S"), 0, "ground resistor below the node"),
    rel("x", pin("rf", net("FB")), ">=", guide("S"), 2, "feedback resistor starts 2 G right of the node"),
    rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
    rel("x", pin("rf", net("OUT")), "<=", guide("T"), -1, "feedback resistor ends left of the tap"),
    rel("x", env("rf", "right"), "<=", guide("T"), -1, "feedback label clear of the tap column"),
    rel("y", env("rf", "top"), ">=", env("u", "bottom"), 1, "feedback resistor below the op-amp, 1 G corridor"),
    rel("y", env("rg", "top"), ">=", env("rf", "bottom"), 1, "ground resistor below the feedback row"),
  ],
  boundary: [["u", "IN+"], ["u", "OUT"], ["rg", { net: "RAIL" }]],
  trunks: [{
    net: "FB", why: "the feedback node: one vertical conductor at S from IN- to the feedback row",
    points: [{ x: guide("S"), y: pin("u", "IN-") }, { x: guide("S"), y: pin("rf", net("FB")) }],
  }, {
    net: "OUT", why: "the output line to the tap column, and down to the feedback resistor",
    points: [
      { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
      { x: guide("T"), y: pin("u", "OUT") },
      { x: guide("T"), y: pin("rf", net("OUT")) },
    ],
    require: [{ pin: ["u", "OUT"], dir: "right" }],
  }],
};

/**
 * I2C bus with pull-ups (Appendix A.2). The region is the two pull-ups; the controller and the
 * peripherals stay their own blocks but get pin sides, ranks and linking constraints. Each
 * peripheral gets its own column (one row of peripherals, left to right in canonical order).
 */
const I2C: Template = {
  id: "i2c-pullups", version: 1, priority: 5,
  summary: "nets with i2c.sda / i2c.scl interface roles; a pull-up from each to one supply",
  nets: { SDA: { iface: "i2c.sda" }, SCL: { iface: "i2c.scl" }, RAIL: { kind: ["power"] } },
  slots: [
    { name: "ctrl", types: ["ic"], role: "link", prefer: { prop: "controller", value: "true" }, rank: { offset: 0 },
      pins: [{ pin: SDA, net: "SDA" }, { pin: SCL, net: "SCL" }], sides: { right: [SDA, SCL] } },
    { name: "pu1", types: ["resistor"], role: "member", symmetric: true, orient: { net: "RAIL", dir: "up" }, rank: { offset: 1 },
      pins: [{ pin: "1", net: "SDA" }, { pin: "2", net: "RAIL" }] },
    { name: "pu2", types: ["resistor"], role: "member", symmetric: true, orient: { net: "RAIL", dir: "up" }, rank: { offset: 1 },
      pins: [{ pin: "1", net: "SCL" }, { pin: "2", net: "RAIL" }] },
    { name: "periph", types: ["ic"], role: "link", many: { min: 1 }, rank: { offset: 2, step: 1 },
      pins: [{ pin: SDA, net: "SDA" }, { pin: SCL, net: "SCL" }],
      sides: { top: [SCL, SDA], right: [{ role: "power_in" }], bottom: [{ role: "ground" }] } },
  ],
  interior: [
    rel("y", pin("pu2", net("RAIL")), "=", pin("pu1", net("RAIL")), 0, "pull-ups side by side"),
    rel("x", env("pu2", "left"), ">=", env("pu1", "right"), 1, "SCL pull-up right of the SDA pull-up and its label"),
  ],
  link: [
    rel("y", pin("pu1", net("SDA")), "=", pin("ctrl", SDA), -2, "pull-up bodies just above the SDA trunk"),
    rel("x", pin("pu1", net("SDA")), ">=", pin("ctrl", SDA), 3, "SDA pull-up tap clear of the controller pin"),
    rel("y", env("periph", "top"), ">=", pin("ctrl", SCL), 2, "peripheral labels clear of the SCL trunk"),
    rel("y", pin("periph", SDA), "=", pin("periph", SDA), 0, "peripherals in one row", { each: "chain" }),
  ],
  trunks: [
    { net: "SDA", why: "SDA trunk from the controller pin to the last peripheral's tap",
      points: [{ x: pin("ctrl", SDA), dx: 1, y: pin("ctrl", SDA) }, { x: pin("periph", SDA, "max"), y: pin("ctrl", SDA) }],
      require: [{ pin: ["ctrl", SDA], dir: "right" }, { pin: ["periph", SDA], dir: "up" }] },
    { net: "SCL", why: "SCL trunk 2 G below, to the last peripheral's tap",
      points: [{ x: pin("ctrl", SCL), dx: 1, y: pin("ctrl", SCL) }, { x: pin("periph", SCL, "max"), y: pin("ctrl", SCL) }],
      require: [{ pin: ["ctrl", SCL], dir: "right" }, { pin: ["periph", SCL], dir: "up" }] },
  ],
};

/** Voltage divider: one vertical column, the tap between the resistors (a T to the right). */
const DIVIDER: Template = {
  id: "voltage-divider", version: 1, priority: 8,
  summary: "two resistors in series between a supply and ground with a tap",
  nets: { TOP: { kind: ["power"] }, TAP: { kind: ["signal"] }, BOT: { kind: ["ground"] } },
  slots: [
    { name: "rt", types: ["resistor"], role: "member", symmetric: true, orient: { net: "TOP", dir: "up" },
      pins: [{ pin: "1", net: "TOP" }, { pin: "2", net: "TAP" }] },
    { name: "rb", types: ["resistor"], role: "member", symmetric: true, orient: { net: "TAP", dir: "up" },
      pins: [{ pin: "1", net: "TAP" }, { pin: "2", net: "BOT" }] },
  ],
  interior: [
    rel("x", pin("rb", net("TAP")), "=", pin("rt", net("TAP")), 0, "one vertical column"),
    // 4 G apart: the tap row (2 G below the upper resistor, where the straight-wire pass puts a
    // sideways pin) is the middle of the link, so the T sits clear of both resistor ends.
    rel("y", pin("rb", net("TAP")), "=", pin("rt", net("TAP")), 4, "the tap node between the two resistors"),
  ],
};

/**
 * Pull-up / pull-down: vertical from the rail symbol to the signal wire. Only for a signal net
 * with a driver and a receiver (3+ endpoints); a two-endpoint net is a series path (LED template).
 */
const PULL_UP: Template = {
  id: "pull-up", version: 1, priority: 10,
  summary: "resistor between a signal net and a supply drawn as a symbol",
  nets: { SIG: { kind: ["signal"], minEndpoints: 3 }, RAIL: { kind: ["power"], port: true } },
  slots: [{ name: "r", types: ["resistor"], role: "member", symmetric: true, orient: { net: "RAIL", dir: "up" },
    pins: [{ pin: "1", net: "SIG" }, { pin: "2", net: "RAIL" }] }],
};
const PULL_DOWN: Template = {
  id: "pull-down", version: 1, priority: 10,
  summary: "resistor between a signal net and ground drawn as a symbol",
  nets: { SIG: { kind: ["signal"], minEndpoints: 3 }, RAIL: { kind: ["ground"], port: true } },
  slots: [{ name: "r", types: ["resistor"], role: "member", symmetric: true, orient: { net: "RAIL", dir: "down" },
    pins: [{ pin: "1", net: "SIG" }, { pin: "2", net: "RAIL" }] }],
};

/**
 * LED + series resistor: in line, resistor first. With the cathode on ground the pair stands
 * vertical (ground at the bottom, SPEC 9.1 rule 10); otherwise it lies horizontal.
 */
const LED_VERTICAL: Template = {
  id: "led-series-vertical", version: 1, priority: 11,
  summary: "resistor in series with an LED whose cathode is on ground drawn as a symbol",
  nets: { N: { kind: ["signal"], endpoints: 2 }, K: { kind: ["ground"], port: true } },
  slots: [
    { name: "r", types: ["resistor"], role: "member", symmetric: true, orient: { net: "N", dir: "down" },
      pins: [{ pin: "1", net: "*", pred: { kind: ["signal", "power"] } }, { pin: "2", net: "N" }] },
    { name: "d", types: ["led"], role: "member", orient: { net: "N", dir: "up" },
      pins: [{ pin: "anode", net: "N" }, { pin: "cathode", net: "K" }] },
  ],
  interior: [
    rel("x", pin("d", net("N")), "=", pin("r", net("N")), 0, "in line"),
    rel("y", pin("d", net("N")), "=", pin("r", net("N")), 2, "resistor first, a short wire to the anode"),
  ],
};
const LED_HORIZONTAL: Template = {
  id: "led-series", version: 1, priority: 12,
  summary: "resistor in series with an LED",
  nets: { N: { kind: ["signal"], endpoints: 2 }, K: { kind: ["signal", "power"] } },
  slots: [
    { name: "r", types: ["resistor"], role: "member", symmetric: true, orient: { net: "N", dir: "right" },
      pins: [{ pin: "1", net: "*", pred: { kind: ["signal", "power"] } }, { pin: "2", net: "N" }] },
    { name: "d", types: ["led"], role: "member", orient: { net: "N", dir: "left" },
      pins: [{ pin: "anode", net: "N" }, { pin: "cathode", net: "K" }] },
  ],
  interior: [
    rel("y", pin("d", net("N")), "=", pin("r", net("N")), 0, "in line"),
    rel("x", pin("d", net("N")), "=", pin("r", net("N")), 2, "resistor first, a short wire to the anode"),
  ],
};

// ---------------------------------------------------------------------------
// Stubs: matcher data written ahead of the symbols they need (nmos, npn, diode, header are
// being added). Pin names are provisional and must be checked against the new symbols; the
// layout constraints are still to be written (docs/PHASE0B-NOTES.md, "Templates").

const LOW_SIDE_SWITCH: Template = {
  id: "low-side-switch", version: 0, priority: 6, status: "stub",
  summary: "transistor with load to supply on collector/drain, emitter/source to ground, resistor into base/gate",
  nets: { SW: { kind: ["signal"] }, GND: { kind: ["ground"] }, SUP: { kind: ["power"] }, CTL: { kind: ["signal"] }, DRV: { kind: ["signal"] } },
  slots: [
    { name: "q", types: ["nmos", "npn"], role: "member", pins: [{ pin: "D", net: "SW" }, { pin: "S", net: "GND" }, { pin: "G", net: "CTL" }] },
    { name: "load", types: ["resistor", "led", "relay", "motor", "inductor"], role: "member", symmetric: true, pins: [{ pin: "1", net: "SUP" }, { pin: "2", net: "SW" }] },
    { name: "rg", types: ["resistor"], role: "member", symmetric: true, pins: [{ pin: "1", net: "DRV" }, { pin: "2", net: "CTL" }] },
  ],
};

const H_BRIDGE: Template = {
  id: "h-bridge", version: 0, priority: 3, status: "stub",
  summary: "four switches in two legs between one supply and ground; load between the leg midpoints",
  nets: { SUP: { kind: ["power"] }, GND: { kind: ["ground"] }, A: { kind: ["signal"] }, B: { kind: ["signal"] } },
  slots: [
    { name: "qa_hi", types: ["nmos", "pmos", "npn", "pnp"], role: "member", pins: [{ pin: "D", net: "SUP" }, { pin: "S", net: "A" }] },
    { name: "qa_lo", types: ["nmos", "npn"], role: "member", pins: [{ pin: "D", net: "A" }, { pin: "S", net: "GND" }] },
    { name: "qb_hi", types: ["nmos", "pmos", "npn", "pnp"], role: "member", pins: [{ pin: "D", net: "SUP" }, { pin: "S", net: "B" }] },
    { name: "qb_lo", types: ["nmos", "npn"], role: "member", pins: [{ pin: "D", net: "B" }, { pin: "S", net: "GND" }] },
    { name: "load", types: ["motor", "resistor", "inductor"], role: "member", symmetric: true, pins: [{ pin: "1", net: "A" }, { pin: "2", net: "B" }] },
  ],
};

const BRIDGE_RECTIFIER: Template = {
  id: "bridge-rectifier", version: 0, priority: 4, status: "stub",
  summary: "four diodes forming a full bridge",
  nets: { AC1: {}, AC2: {}, POS: {}, NEG: {} },
  slots: [
    { name: "d1", types: ["diode"], role: "member", pins: [{ pin: "A", net: "AC1" }, { pin: "K", net: "POS" }] },
    { name: "d2", types: ["diode"], role: "member", pins: [{ pin: "A", net: "AC2" }, { pin: "K", net: "POS" }] },
    { name: "d3", types: ["diode"], role: "member", pins: [{ pin: "A", net: "NEG" }, { pin: "K", net: "AC1" }] },
    { name: "d4", types: ["diode"], role: "member", pins: [{ pin: "A", net: "NEG" }, { pin: "K", net: "AC2" }] },
  ],
};

const DECOUPLING: Template = {
  id: "decoupling", version: 0, priority: 7, status: "stub",
  summary: "capacitor between an IC power pin's net and ground (a child slot of the IC's region)",
  nets: { SUP: { kind: ["power"] }, GND: { kind: ["ground"] } },
  slots: [
    { name: "ic", types: ["ic"], role: "link", pins: [{ pin: { role: "power_in" }, net: "SUP" }] },
    { name: "c", types: ["capacitor"], role: "member", symmetric: true, orient: { net: "SUP", dir: "up" }, pins: [{ pin: "1", net: "SUP" }, { pin: "2", net: "GND" }] },
  ],
};

/** All templates, active and stubs; the engine sorts matches by priority. */
export const TEMPLATES: readonly Template[] = [
  OPAMP_INVERTING, OPAMP_NONINVERTING, H_BRIDGE, BRIDGE_RECTIFIER, I2C, LOW_SIDE_SWITCH, DECOUPLING,
  DIVIDER, PULL_UP, PULL_DOWN, LED_VERTICAL, LED_HORIZONTAL,
];
