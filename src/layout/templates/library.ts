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
      // Supply pins on top after SDA/SCL: the trunks end at the bus pins, left of the supply
      // port, and a decoupling child slot (src/layout/decoupling.ts) can serve the pin.
      sides: { top: [SCL, SDA, { role: "power_in" }], bottom: [{ role: "ground" }] } },
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
// Switching templates (Phase 0b symbols: nmos, pmos, npn, pnp, diode, relay, motor).

/** Pin names of a transistor type: control (gate, base), main (drain, collector), reference (source, emitter). */
const Q: Record<string, { ctrl: string; main: string; ref: string }> = {
  nmos: { ctrl: "G", main: "D", ref: "S" }, pmos: { ctrl: "G", main: "D", ref: "S" },
  npn: { ctrl: "B", main: "C", ref: "E" }, pnp: { ctrl: "B", main: "C", ref: "E" },
};
const MIRROR = { rot: 0 as const, flip: true };
const UPRIGHT = { rot: 0 as const, flip: false };
const box = (slot: string, edge: "left" | "right" | "top" | "bottom"): Ref => ({ box: [slot, edge] });

/**
 * Complementary H-bridge (P-type high side, N-type low side): two vertical legs side by side,
 * high side above low side, the load horizontal between the leg midpoints. Each gate's drive
 * faces outward (left leg mirrored to the left, right leg to the right): its series resistor in
 * line with the gate, its gate-source resistor vertical from the node between them to the rail.
 * The part driving the first gate resistor (a connector) ranks one column before the bridge.
 */
function hBridge(hi: "pmos" | "pnp", lo: "nmos" | "npn"): Template {
  const H = Q[hi]!, L = Q[lo]!;
  const legs = [["a", "A", "", UPRIGHT], ["b", "B", "", MIRROR]] as const;
  const slots: Template["slots"] = [];
  const interior: Rel[] = [], trunks: NonNullable<Template["trunks"]> = [], boundary: Array<[string, { net: string } | string]> = [];
  for (const [l, N, , orient] of legs) {
    const out = l === "a" ? "right" : "left";  // gate drive side: outward
    const hiS = `q${l}h`, loS = `q${l}l`;
    slots.push(
      { name: hiS, types: [hi], role: "member", orient, label: l === "a" ? "right" : "left", ...(l === "a" ? { rank: { offset: 1 } } : {}),
        pins: [{ pin: H.ref, net: "SUP" }, { pin: H.main, net: N }, { pin: H.ctrl, net: `G${l}H` }] },
      { name: loS, types: [lo], role: "member", orient, label: l === "a" ? "right" : "left",
        pins: [{ pin: L.main, net: N }, { pin: L.ref, net: "GND" }, { pin: L.ctrl, net: `G${l}L` }] },
    );
    for (const [s, q, g, rail, railDir] of [[`r${l}h`, hiS, `G${l}H`, "SUP", "up"], [`r${l}l`, loS, `G${l}L`, "GND", "down"]] as const) {
      const p = `p${s.slice(1)}`; // gate-source resistor slot
      slots.push(
        { name: s, types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: g, dir: out },
          pins: [{ pin: "1", net: "*", pred: { kind: ["signal"] } }, { pin: "2", net: g }] },
        { name: p, types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: rail, dir: railDir },
          pins: [{ pin: "1", net: g }, { pin: "2", net: rail }] },
      );
      const ctrl = pin(q, l === "a" ? (q === hiS ? H.ctrl : L.ctrl) : (q === hiS ? H.ctrl : L.ctrl));
      const sign = l === "a" ? 1 : -1; // + : the drive is left of the gate
      interior.push(
        rel("y", pin(s, net(g)), "=", ctrl, 0, "gate resistor in line with the gate"),
        rel("y", pin(p, net(g)), "=", ctrl, railDir === "up" ? -2 : 2, "gate-source resistor from the gate wire to its rail"),
        // Without a gate-source resistor this keeps the gate resistor itself off the transistor.
        sign > 0
          ? rel("x", ctrl, ">=", pin(s, net(g)), 2, "a wire between the gate resistor and the gate")
          : rel("x", pin(s, net(g)), ">=", ctrl, 2, "a wire between the gate and the gate resistor"),
        ...(sign > 0 ? [
          rel("x", pin(p, net(g)), ">=", pin(s, net(g)), 2, "node between the gate resistor and the gate"),
          rel("x", ctrl, ">=", pin(p, net(g)), 2, "node left of the gate"),
          rel("x", env(p, "left"), ">=", env(s, "right"), 1, "clear of the gate resistor's label"),
          rel("x", env(p, "right"), "<=", box(q, "left"), -1, "clear of the transistor"),
        ] : [
          rel("x", pin(s, net(g)), ">=", pin(p, net(g)), 2, "node between the gate and the gate resistor"),
          rel("x", pin(p, net(g)), ">=", ctrl, 2, "node right of the gate"),
          rel("x", env(s, "left"), ">=", env(p, "right"), 1, "clear of the gate-source resistor's label"),
          rel("x", env(p, "left"), ">=", box(q, "right"), 1, "clear of the transistor"),
        ]),
      );
      boundary.push([s, { net: "*" }]);
    }
    const hiMain = pin(hiS, H.main), loMain = pin(loS, L.main);
    interior.push(
      rel("x", loMain, "=", hiMain, 0, "one vertical leg"),
      rel("y", loMain, "=", hiMain, 4, "high side above low side; the midpoint between them"),
    );
    trunks.push({ net: N, why: "the leg's midpoint conductor", points: [{ x: hiMain, y: hiMain, dy: 1 }, { x: loMain, y: loMain, dy: -1 }],
      require: [{ pin: [hiS, H.main], dir: "down" }, { pin: [loS, L.main], dir: "up" }] });
    boundary.push([hiS, H.ctrl], [loS, L.ctrl]);
  }
  slots.push({ name: "load", types: ["motor", "resistor", "inductor"], role: "member", symmetric: true, orient: { net: "A", dir: "left" },
    pins: [{ pin: "1", net: "A" }, { pin: "2", net: "B" }] });
  // The connector or chip driving the first gate resistor: one column before the bridge (it is
  // not a flow source, so without this it would rank by the low-confidence second pass).
  slots.push({ name: "drv", types: ["header", "ic"], role: "link", many: { min: 0 }, follow: { slot: "rah" }, pins: [], rank: { offset: 0 } });
  interior.push(
    rel("y", pin("qbh", H.main), "=", pin("qah", H.main), 0, "legs side by side"),
    rel("y", pin("load", net("A")), "=", pin("qah", H.main), 2, "load between the leg midpoints"),
    rel("x", env("load", "left"), ">=", env("qah", "right"), 1, "load right of the left leg and its labels"),
    rel("x", env("load", "left"), ">=", env("qal", "right"), 1, "load right of the left leg and its labels"),
    rel("x", env("qbh", "left"), ">=", env("load", "right"), 1, "right leg right of the load"),
    rel("x", env("qbl", "left"), ">=", env("load", "right"), 1, "right leg right of the load"),
  );
  return {
    id: `h-bridge-${hi}-${lo}`, version: 1, priority: 3,
    summary: `complementary H-bridge: ${hi} high side, ${lo} low side, load between the leg midpoints`,
    nets: { SUP: { kind: ["power"] }, GND: { kind: ["ground"] }, A: { kind: ["signal"] }, B: { kind: ["signal"] },
      GaH: { kind: ["signal"] }, GaL: { kind: ["signal"] }, GbH: { kind: ["signal"] }, GbL: { kind: ["signal"] } },
    slots, interior, trunks, boundary,
  };
}

/**
 * Low-side switch: the load above the transistor on one vertical, the flyback diode parallel to
 * the load on its left, the base or gate resistor horizontal on the left in line with the control
 * pin, and a pull-down from the node between them. `relay`: the load is a relay coil (A1, A2).
 */
function lowSide(q: "npn" | "nmos", load: "relay" | "two-pin"): Template {
  const T = Q[q]!;
  const loadSlot: Template["slots"][number] = load === "relay"
    ? { name: "load", types: ["relay"], role: "member", orient: UPRIGHT, pins: [{ pin: "A1", net: "SUP" }, { pin: "A2", net: "SW" },
      { pin: "11", net: "COM", optional: true }, { pin: "14", net: "NO", optional: true }, { pin: "12", net: "NC", optional: true }] }
    : { name: "load", types: ["resistor", "motor", "inductor"], role: "member", symmetric: true, orient: { net: "SW", dir: "down" }, pins: [{ pin: "1", net: "SUP" }, { pin: "2", net: "SW" }] };
  return {
    id: `low-side-${q}-${load}`, version: 1, priority: 6,
    summary: `${q} low-side switch with a ${load === "relay" ? "relay coil" : "two-pin"} load to the supply`,
    nets: { SW: { kind: ["signal"] }, GND: { kind: ["ground"] }, SUP: { kind: ["power"] }, CTL: { kind: ["signal"] },
      COM: { kind: ["signal"] }, NO: { kind: ["signal"] }, NC: { kind: ["signal"] } },
    ...(load === "relay" ? {
      // The terminal block the contacts go to: right of the relay, its COM pin level with the
      // relay's COM lead, so COM runs straight and NO and NC make short loops over the contacts.
      link: [
        rel("y", pin("conn", net("COM")), "=", pin("load", "11"), 1, "COM terminal level with the COM lead"),
        rel("x", env("conn", "left"), ">=", env("load", "right"), 5, "room for the NO and NC loops"),
      ],
    } : {}),
    slots: [
      { name: "q", types: [q], role: "member", orient: UPRIGHT, pins: [{ pin: T.main, net: "SW" }, { pin: T.ref, net: "GND" }, { pin: T.ctrl, net: "CTL" }] },
      loadSlot,
      { name: "fly", types: ["diode"], role: "member", many: { min: 0 }, orient: { net: "SW", dir: "down" }, label: "left",
        pins: [{ pin: "A", net: "SW" }, { pin: "K", net: "SUP" }] },
      { name: "rb", types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: "CTL", dir: "right" },
        pins: [{ pin: "1", net: "*", pred: { kind: ["signal"] } }, { pin: "2", net: "CTL" }] },
      { name: "pd", types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: "GND", dir: "down" },
        pins: [{ pin: "1", net: "CTL" }, { pin: "2", net: "GND" }] },
      ...(load === "relay" ? [{ name: "conn", types: ["header"], role: "link" as const, many: { min: 0 },
        pins: [{ pin: { on: "COM" }, net: "COM" }, { pin: { on: "NO" }, net: "NO" }, { pin: { on: "NC" }, net: "NC" }] }] : []),
    ],
    interior: [
      rel("x", pin("load", net("SW")), "=", pin("q", T.main), 0, "load above the transistor on one vertical"),
      rel("y", pin("q", T.main), "=", pin("load", net("SW")), 4, "the switched node between them"),
      rel("y", pin("fly", net("SUP")), "=", pin("load", net("SUP")), 0, "flyback diode level with the load, cathode to the supply"),
      rel("x", env("fly", "right"), "<=", box("load", "left"), -1, "flyback diode just left of the load"),
      rel("x", pin("fly", net("SW")), ">=", box("load", "left"), -4, "flyback diode close to the load"),
      rel("y", pin("rb", net("CTL")), "=", pin("q", T.ctrl), 0, "drive resistor in line with the control pin"),
      rel("x", pin("q", T.ctrl), ">=", pin("rb", net("CTL")), 2, "a wire between the drive resistor and the control pin (also without a pull-down)"),
      rel("y", pin("pd", net("CTL")), "=", pin("q", T.ctrl), 2, "pull-down from the control wire to ground"),
      rel("x", pin("pd", net("CTL")), ">=", pin("rb", net("CTL")), 2, "node between the drive resistor and the control pin"),
      rel("x", pin("q", T.ctrl), ">=", pin("pd", net("CTL")), 2, "node left of the control pin"),
      rel("x", env("pd", "left"), ">=", env("rb", "right"), 1, "clear of the drive resistor's label"),
      rel("x", env("pd", "right"), "<=", box("q", "left"), -1, "clear of the transistor"),
    ],
    trunks: [{ net: "SW", why: "the switched node from the load down to the transistor",
      points: [{ x: pin("load", net("SW")), y: pin("load", net("SW")), dy: 1 }, { x: pin("q", T.main), y: pin("q", T.main), dy: -1 }],
      require: [{ pin: ["load", { net: "SW" }], dir: "down" }, { pin: ["q", T.main], dir: "up" }] }],
    boundary: [["rb", { net: "*" }], ["q", T.ctrl], ["load", "11"], ["load", "12"], ["load", "14"]],
  };
}

/**
 * Bridge rectifier, orthogonal convention: two vertical diode legs side by side, cathodes up to
 * the + output, anodes down to the - output, the AC inputs at the leg midpoints from the left.
 */
const BRIDGE_RECTIFIER: Template = {
  id: "bridge-rectifier", version: 1, priority: 4,
  summary: "four diodes forming a full bridge",
  nets: { AC1: {}, AC2: {}, POS: {}, NEG: {} },
  slots: [
    { name: "d1", types: ["diode"], role: "member", orient: { net: "POS", dir: "up" }, label: "left", pins: [{ pin: "A", net: "AC1" }, { pin: "K", net: "POS" }] },
    { name: "d3", types: ["diode"], role: "member", orient: { net: "AC1", dir: "up" }, label: "left", pins: [{ pin: "A", net: "NEG" }, { pin: "K", net: "AC1" }] },
    { name: "d2", types: ["diode"], role: "member", orient: { net: "POS", dir: "up" }, label: "right", pins: [{ pin: "A", net: "AC2" }, { pin: "K", net: "POS" }] },
    { name: "d4", types: ["diode"], role: "member", orient: { net: "AC2", dir: "up" }, label: "right", pins: [{ pin: "A", net: "NEG" }, { pin: "K", net: "AC2" }] },
  ],
  interior: [
    rel("x", pin("d3", net("AC1")), "=", pin("d1", net("AC1")), 0, "left leg vertical"),
    rel("y", pin("d3", net("AC1")), "=", pin("d1", net("AC1")), 6, "left leg: the AC1 node between the diodes"),
    rel("x", pin("d4", net("AC2")), "=", pin("d2", net("AC2")), 0, "right leg vertical"),
    rel("y", pin("d4", net("AC2")), "=", pin("d2", net("AC2")), 6, "right leg: the AC2 node between the diodes"),
    rel("y", pin("d2", net("POS")), "=", pin("d1", net("POS")), 0, "legs side by side"),
    rel("x", pin("d2", net("POS")), ">=", pin("d1", net("POS")), 4, "right leg right of the left leg"),
  ],
  trunks: [
    { net: "AC1", why: "the left leg's midpoint conductor",
      points: [{ x: pin("d1", net("AC1")), y: pin("d1", net("AC1")), dy: 1 }, { x: pin("d3", net("AC1")), y: pin("d3", net("AC1")), dy: -1 }],
      require: [{ pin: ["d1", "A"], dir: "down" }, { pin: ["d3", "K"], dir: "up" }] },
    { net: "AC2", why: "the right leg's midpoint conductor",
      points: [{ x: pin("d2", net("AC2")), y: pin("d2", net("AC2")), dy: 1 }, { x: pin("d4", net("AC2")), y: pin("d4", net("AC2")), dy: -1 }],
      require: [{ pin: ["d2", "A"], dir: "down" }, { pin: ["d4", "K"], dir: "up" }] },
  ],
};

/** All templates; the engine sorts matches by priority. Decoupling is handled by src/layout/decoupling.ts. */
export const TEMPLATES: readonly Template[] = [
  OPAMP_INVERTING, OPAMP_NONINVERTING, hBridge("pmos", "nmos"), hBridge("pnp", "npn"), BRIDGE_RECTIFIER, I2C,
  lowSide("npn", "relay"), lowSide("nmos", "relay"), lowSide("npn", "two-pin"), lowSide("nmos", "two-pin"),
  DIVIDER, PULL_UP, PULL_DOWN, LED_VERTICAL, LED_HORIZONTAL,
];
