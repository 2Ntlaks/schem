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
const own = (slot: string, edge: "left" | "right" | "top" | "bottom"): Ref => ({ own: [slot, edge] });
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
      pins: [{ pin: "1", net: "*", pred: { kind: ["signal"], forbidPin: [{ type: "opamp", pin: "2" }] } }, { pin: "2", net: "SUM" }] },
    // Difference amplifier: optional resistor into IN+ and shunt resistor from IN+ to ground.
    { name: "rplus", types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: "REF", dir: "right" }, label: "below",
      pins: [{ pin: "1", net: "*", pred: { kind: ["signal"] } }, { pin: "2", net: "REF", pred: { kind: ["signal"] } }] },
    { name: "rgnd", types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: "REF", dir: "up" }, label: "left",
      pins: [{ pin: "1", net: "REF", pred: { kind: ["signal"] } }, { pin: "2", net: "*", pred: { kind: ["ground"] } }] },
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
    // Optional IN+ difference-amplifier resistors.
    rel("y", pin("rplus", net("REF")), "=", pin("u", "IN+"), 0, "IN+ resistor in line with IN+", { when: { slot: "rplus", min: 1 } }),
    rel("x", pin("rplus", net("REF")), "=", pin("rin", net("SUM")), 0, "IN+ resistor aligned with IN- resistor", { each: "first", when: { slot: "rplus", min: 1 } }),
    rel("x", pin("rgnd", net("REF")), "=", pin("u", "IN+"), -2, "IN+ shunt resistor hangs 2 G left of IN+", { when: { slot: "rgnd", min: 1 } }),
    rel("y", pin("rgnd", net("REF")), "=", pin("u", "IN+"), 2, "IN+ shunt resistor hangs from the IN+ line", { when: { slot: "rgnd", min: 1 } }),
    rel("x", env("rplus", "right"), "<=", env("rgnd", "left"), -1, "IN+ resistor clear of the shunt resistor and its label", { when: { slot: "rgnd", min: 1 } }),
  ],
  link: [
    // Sources stay stacked in their column; each one sits right of the one above, so its wire
    // runs straight up past it and turns once into its input (Appendix A.1: "+" up, one bend).
    rel("x", pin("src", net("*")), ">=", env("src", "right"), 1, "sources stepped right, in input order", { each: "chain" }),
  ],
  boundary: [["rin", { net: "*" }], ["rplus", { net: "*" }], ["rgnd", { net: "*" }], ["u", "OUT"], ["u", "IN+"]],
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
  id: "i2c-pullups", version: 2, priority: 5,
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
    // Its own outline only: decoupling capacitors stand on the supply pin, right of the bus pins
    // where the trunks end, so they may rise past the trunk rows.
    rel("y", own("periph", "top"), ">=", pin("ctrl", SCL), 2, "peripheral labels clear of the SCL trunk"),
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

/**
 * Voltage divider: one vertical column for a 3-endpoint tap, or lower resistor staggered 2 G right
 * on a pass-through signal line (4+ endpoints on the tap) so the signal runs straight through two
 * clean T-junctions instead of looping under the lower resistor to avoid a four-way node.
 */
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
    rel("x", pin("rb", net("TAP")), "=", pin("rt", net("TAP")), 0, "one vertical column", { when: { net: "TAP", maxEndpoints: 3 } }),
    rel("x", pin("rb", net("TAP")), "=", pin("rt", net("TAP")), 2, "stagger lower resistor 2 G right for two clean T-junctions", { when: { net: "TAP", minEndpoints: 4 } }),
    // 4 G apart: the tap row (2 G below the upper resistor, where the straight-wire pass puts a
    // sideways pin) is the middle of the link, so the T sits clear of both resistor ends.
    rel("y", pin("rb", net("TAP")), "=", pin("rt", net("TAP")), 4, "the tap node between the two resistors"),
  ],
  trunks: [{
    net: "TAP", why: "staggered tap link between the upper and lower divider resistors",
    when: { net: "TAP", minEndpoints: 4 },
    points: [
      { x: pin("rt", net("TAP")), y: pin("rt", net("TAP")), dy: 1 },
      { x: pin("rt", net("TAP")), y: pin("rt", net("TAP")), dy: 2 },
      { x: pin("rb", net("TAP")), y: pin("rt", net("TAP")), dy: 2 },
      { x: pin("rb", net("TAP")), y: pin("rb", net("TAP")), dy: -1 },
    ],
    require: [{ pin: ["rt", { net: "TAP" }], dir: "down" }, { pin: ["rb", { net: "TAP" }], dir: "up" }],
  }],
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
 * Differential pair with a current-mirror load and a resistor tail (the long-tailed pair), in its
 * textbook shape: two vertical legs 18 G apart, the mirror on top (emitters or sources up to the
 * supply), the pair below, the tail resistor centred under the pair. The mirror's bases face each
 * other on one line; the diode-connected side is the left leg, its node tied up to that line. The
 * pair's bases face outward: the left input from the left, the right input to the right; the
 * output is the right leg's midpoint.
 */
function diffPair(pair: "npn" | "nmos", load: "pnp" | "pmos"): Template {
  const P = Q[pair]!, M = Q[load]!;
  const W = 18; // leg spacing: the base line, the diode tie, and the pair's labels apart between the legs
  return {
    id: `diff-pair-${pair}-${load}-mirror`, version: 1, priority: 3,
    summary: `${pair} differential pair with a ${load} current-mirror load and a resistor tail`,
    nets: { SUP: { kind: ["power"] }, MIR: { kind: ["signal"] }, OUT: { kind: ["signal"] }, TAIL: { kind: ["signal"] } },
    slots: [
      // The diode-connected mirror half first: its collector and base on one net fix MIR.
      { name: "m1", types: [load], role: "member", orient: MIRROR, label: "left",
        pins: [{ pin: M.ref, net: "SUP" }, { pin: M.main, net: "MIR" }, { pin: M.ctrl, net: "MIR" }] },
      { name: "m2", types: [load], role: "member", orient: UPRIGHT, label: "right",
        pins: [{ pin: M.ref, net: "SUP" }, { pin: M.main, net: "OUT" }, { pin: M.ctrl, net: "MIR" }] },
      // The pair's labels go between the legs: the input wires take the outer sides.
      { name: "q1", types: [pair], role: "member", orient: UPRIGHT, label: "right",
        pins: [{ pin: P.main, net: "MIR" }, { pin: P.ref, net: "TAIL" }, { pin: P.ctrl, net: "*" }] },
      { name: "q2", types: [pair], role: "member", orient: MIRROR, label: "left",
        pins: [{ pin: P.main, net: "OUT" }, { pin: P.ref, net: "TAIL" }, { pin: P.ctrl, net: "*" }] },
      { name: "rt", types: ["resistor"], role: "member", symmetric: true, orient: { net: "TAIL", dir: "up" },
        pins: [{ pin: "1", net: "TAIL" }, { pin: "2", net: "*" }] },
      // A load resistor on the output, hanging from the output node to the right.
      { name: "rl", types: ["resistor"], role: "member", symmetric: true, many: { min: 0 }, orient: { net: "OUT", dir: "up" },
        pins: [{ pin: "1", net: "OUT" }, { pin: "2", net: "*" }] },
    ],
    interior: [
      rel("x", pin("m1", M.main), "=", pin("q1", P.main), 0, "left leg vertical"),
      rel("x", pin("m2", M.main), "=", pin("q2", P.main), 0, "right leg vertical"),
      rel("x", pin("q2", P.main), "=", pin("q1", P.main), W, "the legs side by side, 18 G apart"),
      rel("y", pin("m2", M.main), "=", pin("m1", M.main), 0, "the mirror in one row"),
      rel("y", pin("q2", P.main), "=", pin("q1", P.main), 0, "the pair in one row"),
      rel("y", pin("q1", P.main), "=", pin("m1", M.main), 4, "mirror above the pair; the leg nodes between them"),
      rel("x", pin("rt", net("TAIL")), "=", pin("q1", P.ref), W / 2, "tail resistor centred under the pair"),
      rel("y", pin("rt", net("TAIL")), "=", pin("q1", P.ref), 3, "the tail line between the pair and the resistor"),
      rel("y", pin("rl", net("OUT")), "=", pin("m2", M.main), 3, "load just below the output node row"),
      rel("x", pin("rl", net("OUT")), "=", pin("q2", P.ctrl), 6, "load right of the right input and its symbol"),
    ],
    boundary: [["q1", P.ctrl], ["q2", P.ctrl], ["m2", M.main], ["rt", { net: "*" }], ["rl", { net: "*" }]],
    trunks: [
      { net: "MIR", why: "the mirror's base line",
        points: [{ x: pin("m1", M.ctrl), dx: 1, y: pin("m1", M.ctrl) }, { x: pin("m2", M.ctrl), dx: -1, y: pin("m2", M.ctrl) }],
        require: [{ pin: ["m1", M.ctrl], dir: "right" }, { pin: ["m2", M.ctrl], dir: "left" }] },
      { net: "MIR", why: "the left leg: mirror input down to the pair",
        points: [{ x: pin("m1", M.main), y: pin("m1", M.main), dy: 1 }, { x: pin("q1", P.main), y: pin("q1", P.main), dy: -1 }],
        require: [{ pin: ["m1", M.main], dir: "down" }, { pin: ["q1", P.main], dir: "up" }] },
      { net: "MIR", why: "the diode connection: the left leg node up to the base line",
        points: [
          { x: pin("m1", M.main), y: pin("m1", M.main), dy: 2 },
          { x: pin("m1", M.ctrl), dx: 2, y: pin("m1", M.main), dy: 2 },
          { x: pin("m1", M.ctrl), dx: 2, y: pin("m1", M.ctrl) },
        ],
        require: [{ pin: ["m1", M.ctrl], dir: "right" }, { pin: ["m1", M.main], dir: "down" }] },
      { net: "OUT", why: "the right leg: mirror output down to the pair",
        points: [{ x: pin("m2", M.main), y: pin("m2", M.main), dy: 1 }, { x: pin("q2", P.main), y: pin("q2", P.main), dy: -1 }],
        require: [{ pin: ["m2", M.main], dir: "down" }, { pin: ["q2", P.main], dir: "up" }] },
      { net: "TAIL", why: "the tail line: both emitters down to the resistor",
        points: [
          { x: pin("q1", P.ref), y: pin("q1", P.ref), dy: 1 },
          { x: pin("q1", P.ref), y: pin("rt", net("TAIL")), dy: -1 },
          { x: pin("q2", P.ref), y: pin("rt", net("TAIL")), dy: -1 },
          { x: pin("q2", P.ref), y: pin("q2", P.ref), dy: 1 },
        ],
        require: [{ pin: ["q1", P.ref], dir: "down" }, { pin: ["q2", P.ref], dir: "down" }, { pin: ["rt", { net: "TAIL" }], dir: "up" }] },
    ],
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

// ---------------------------------------------------------------------------
// Active filters around one op-amp.

/** The op-amp turned so IN+ is on top and the input comes in straight from the left. */
const PLUS_UP = { rot: 180 as const, flip: true };

/**
 * Sallen-Key second-order filter, in its textbook shape. The two series parts lie in one line
 * into IN+ (the op-amp is turned so IN+ is on top); the shunt part hangs from the node at IN+;
 * the feedback part runs above, from the node between the series parts (column A) to the output
 * tap column T. Low-pass: series resistors, feedback and shunt capacitors. High-pass: the
 * reverse. Unity gain: the output returns below the op-amp to IN- (row R, column S). With gain:
 * the feedback resistor and ground resistor of a non-inverting amplifier hang below, as in that
 * template.
 */
function sallenKey(pass: "lowpass" | "highpass", gain: boolean): Template {
  const series = pass === "lowpass" ? "resistor" : "capacitor", cross = pass === "lowpass" ? "capacitor" : "resistor";
  const FB = gain ? "FB" : "OUT";
  const slots: Template["slots"] = [
    { name: "u", types: ["opamp"], role: "member", orient: PLUS_UP,
      pins: [{ pin: "IN-", net: FB }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "B" }] },
    { name: "z2", types: [series], role: "member", symmetric: true, orient: { net: "B", dir: "right" },
      pins: [{ pin: "1", net: "A" }, { pin: "2", net: "B" }] },
    { name: "zf", types: [cross], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
      pins: [{ pin: "1", net: "A" }, { pin: "2", net: "OUT" }] },
    { name: "zs", types: [cross], role: "member", symmetric: true, orient: { net: "B", dir: "up" }, label: "left",
      pins: [{ pin: "1", net: "B" }, { pin: "2", net: "REF" }] },
    { name: "z1", types: [series], role: "member", symmetric: true, orient: { net: "A", dir: "right" },
      pins: [{ pin: "1", net: "*" }, { pin: "2", net: "A" }] },
  ];
  const interior: Rel[] = [
    // One line into IN+: z1, node A, z2, node B (where the shunt part hangs), IN+.
    rel("x", guide("A"), "=", pin("z1", net("A")), 2, "node A 2 G right of the first series part"),
    rel("x", pin("z2", net("A")), "=", guide("A"), 2, "second series part 2 G right of node A"),
    rel("x", pin("zs", net("B")), "=", pin("z2", net("B")), 2, "shunt part under the node 2 G right of the second series part"),
    rel("x", pin("u", "IN+"), ">=", pin("zs", net("B")), 4, "IN+ at least 4 G right of the shunt node"),
    rel("x", guide("S"), "=", pin("u", "IN-"), -2, "return column S = IN-.x - 2"),
    rel("x", guide("S"), ">=", env("zs", "right"), 1, "shunt part and its label clear of the return column"),
    rel("y", pin("z1", net("A")), "=", pin("u", "IN+"), 0, "series parts in line with IN+"),
    rel("y", pin("z2", net("B")), "=", pin("u", "IN+"), 0, "series parts in line with IN+"),
    rel("y", pin("zs", net("B")), "=", pin("u", "IN+"), 2, "shunt part hangs from the IN+ line"),
    // The feedback part above everything it passes over, between column A and the tap column T.
    rel("x", pin("zf", net("A")), "=", guide("A"), 2, "feedback part starts 2 G right of node A"),
    rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
    rel("x", guide("U"), "=", guide("T"), 2, "feedback column U 2 G right of the tap: no four-way node on the output line"),
    rel("x", pin("zf", net("OUT")), "<=", guide("U"), -1, "feedback part ends left of its column"),
    rel("x", env("zf", "right"), "<=", guide("U"), -1, "feedback label clear of its column"),
    rel("y", env("zf", "bottom"), "<=", env("z2", "top"), -1, "feedback part above the series part and its label"),
    rel("y", env("zf", "bottom"), "<=", env("u", "top"), -1, "feedback part above the op-amp"),
  ];
  const trunks: NonNullable<Template["trunks"]> = [{
    net: "A", why: "node A: one vertical conductor from the series line up to the feedback part",
    points: [
      { x: guide("A"), y: pin("z2", net("A")) },
      { x: guide("A"), y: pin("zf", net("A")) },
      { x: pin("zf", net("A")), dx: -1, y: pin("zf", net("A")) },
    ],
    require: [{ pin: ["zf", { net: "A" }], dir: "left" }],
  }, {
    net: "OUT", why: "the output line past the tap column, and up to the feedback part",
    points: [
      { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
      { x: guide("U"), y: pin("u", "OUT") },
      { x: guide("U"), y: pin("zf", net("OUT")) },
      { x: pin("zf", net("OUT")), dx: 1, y: pin("zf", net("OUT")) },
    ],
    require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["zf", { net: "OUT" }], dir: "right" }],
  }];
  const boundary: NonNullable<Template["boundary"]> = [["z1", { net: "*" }], ["u", "OUT"], ["zs", { net: "REF" }]];
  if (gain) {
    slots.push(
      { name: "rf", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
        pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "OUT" }] },
      { name: "rg", types: ["resistor"], role: "member", symmetric: true, orient: { net: "FB", dir: "up" },
        pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "REF" }] },
    );
    interior.push(
      rel("x", pin("rg", net("FB")), "=", guide("S"), 0, "ground resistor below the feedback node"),
      rel("x", pin("rf", net("FB")), ">=", guide("S"), 2, "feedback resistor starts 2 G right of the node"),
      rel("x", pin("rf", net("OUT")), "<=", guide("T"), -1, "feedback resistor ends left of the tap"),
      rel("x", env("rf", "right"), "<=", guide("T"), -1, "feedback resistor's label clear of the tap column"),
      rel("x", env("rg", "left"), ">=", env("zs", "right"), 1, "ground resistor right of the shunt part"),
      rel("y", env("rf", "top"), ">=", env("u", "bottom"), 1, "feedback resistor below the op-amp, 1 G corridor"),
      rel("y", env("rg", "top"), ">=", env("rf", "bottom"), 1, "ground resistor below the feedback row"),
    );
    trunks.push({
      net: "FB", why: "the feedback node: one vertical conductor at S from IN- to the feedback row",
      points: [{ x: guide("S"), y: pin("u", "IN-") }, { x: guide("S"), y: pin("rf", net("FB")) }],
    }, {
      net: "OUT", why: "the tap column down to the feedback resistor",
      points: [{ x: guide("T"), y: pin("u", "OUT") }, { x: guide("T"), y: pin("rf", net("OUT")) }, { x: pin("rf", net("OUT")), dx: 1, y: pin("rf", net("OUT")) }],
      require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["rf", { net: "OUT" }], dir: "right" }],
    });
    boundary.push(["rg", { net: "REF" }]);
  } else {
    interior.push(rel("y", guide("R"), ">=", env("u", "bottom"), 1, "return row below the op-amp and its label"));
    trunks.push({
      net: "OUT", why: "unity gain: the output returns below the op-amp to IN-",
      points: [
        { x: guide("T"), y: pin("u", "OUT") },
        { x: guide("T"), y: guide("R") },
        { x: guide("S"), y: guide("R") },
        { x: guide("S"), y: pin("u", "IN-") },
        { x: pin("u", "IN-"), dx: -1, y: pin("u", "IN-") },
      ],
      require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["u", "IN-"], dir: "left" }],
    });
  }
  return {
    id: `sallen-key-${pass}${gain ? "-gain" : ""}`, version: 1, priority: 2,
    summary: `Sallen-Key ${pass === "lowpass" ? "low-pass" : "high-pass"} filter${gain ? " with a gain network" : ", unity gain"}: two series ${series}s into IN+, a ${cross} from between them to OUT, a ${cross} from IN+ to the reference`,
    nets: { A: { kind: ["signal"] }, B: { kind: ["signal"] }, OUT: { kind: ["signal"] }, FB: { kind: ["signal"] }, REF: {} },
    slots, interior, trunks, boundary, reserve: ["U"],
  };
}

/**
 * Inverting stages with a capacitor, in the shape of the inverting amplifier above (node column S,
 * feedback above the op-amp, output tap column T). Integrator: a capacitor is the feedback part.
 * Low-pass (`parallel`): a capacitor across the feedback resistor, drawn above it between the
 * same two columns. A differentiator (capacitor inputs) is not here yet: tests/findings.test.ts
 * uses a capacitor-input summing stage as its example of a circuit that matches no template.
 */
function invertingStage(id: string, fb: "resistor" | "capacitor", parallel: boolean, summary: string): Template {
  const top = parallel ? "cf" : "rf"; // the highest feedback part: the node and tap columns reach its row
  return {
    id, version: 1, priority: 1, summary,
    nets: { SUM: { kind: ["signal"] }, OUT: { kind: ["signal"] }, REF: {} },
    slots: [
      { name: "u", types: ["opamp"], role: "member", orient: { rot: 0, flip: false }, label: "below",
        pins: [{ pin: "IN-", net: "SUM" }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "REF" }] },
      { name: "rf", types: [fb], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
        pins: [{ pin: "1", net: "SUM" }, { pin: "2", net: "OUT" }] },
      ...(parallel ? [{ name: "cf", types: ["capacitor"], role: "member" as const, symmetric: true, orient: { net: "OUT", dir: "right" as const },
        pins: [{ pin: "1", net: "SUM" }, { pin: "2", net: "OUT" }] }] : []),
      { name: "rin", types: ["resistor"], role: "member", symmetric: true, many: { min: 1 }, orient: { net: "SUM", dir: "right" },
        pins: [{ pin: "1", net: "*", pred: { kind: ["signal"] } }, { pin: "2", net: "SUM" }] },
      { name: "src", types: ["vsource", "battery"], role: "link", many: { min: 0 }, follow: { slot: "rin" }, pins: [] },
    ],
    interior: [
      rel("x", guide("S"), "=", pin("u", "IN-"), -3, "node column S = IN-.x - 3 (clear of the IN+ symbol)"),
      rel("x", pin("rin", net("SUM")), "<=", guide("S"), -2, "inputs end at least 2 G left of the node"),
      rel("x", pin("rin", net("SUM")), "=", pin("rin", net("SUM")), 0, "inputs end in one column", { each: "chain" }),
      rel("x", env("rin", "right"), "<=", guide("S"), -1, "input labels clear of the node column"),
      rel("x", pin("rf", net("SUM")), ">=", guide("S"), 2, "feedback part starts 2 G right of the node"),
      rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
      rel("x", pin("rf", net("OUT")), "<=", guide("T"), -1, "feedback part ends left of the tap"),
      rel("x", env("rf", "right"), "<=", guide("T"), -1, "feedback label clear of the tap column"),
      rel("y", pin("rin", net("SUM")), "=", pin("u", "IN-"), 0, "a single input is in line with IN-", { when: { slot: "rin", max: 1 } }),
      rel("y", pin("rin", net("SUM")), "=", pin("u", "IN-"), -2, "first input 2 G above IN-", { each: "first", when: { slot: "rin", min: 2 } }),
      rel("y", env("rin", "top"), ">=", pin("rin", net("SUM")), 2, "next input's label 2 G below the previous input's wire", { each: "chain", when: { slot: "rin", min: 2 } }),
      rel("y", env("rf", "bottom"), "<=", env("u", "top"), -1, "feedback part above the op-amp, 1 G corridor"),
      ...(parallel ? [
        rel("x", pin("cf", net("SUM")), "=", pin("rf", net("SUM")), 1, "capacitor centred over the feedback resistor"),
        rel("x", env("cf", "right"), "<=", guide("T"), -1, "capacitor label clear of the tap column"),
        rel("x", env("cf", "left"), ">=", guide("S"), 1, "capacitor label clear of the node column"),
        rel("y", env("cf", "bottom"), "<=", env("rf", "top"), -1, "capacitor above the feedback resistor and its label"),
      ] : []),
    ],
    link: [
      rel("x", pin("src", net("*")), ">=", env("src", "right"), 1, "sources stepped right, in input order", { each: "chain" }),
    ],
    boundary: [["rin", { net: "*" }], ["u", "OUT"], ["u", "IN+"]],
    trunks: [{
      net: "SUM", why: "the summing node: one vertical conductor at S from the top feedback row to the lowest input",
      points: [
        { x: guide("S"), y: pin(top, net("SUM")) },
        { x: guide("S"), y: [pin("rin", net("SUM"), "max"), pin("u", "IN-")], agg: "max" },
      ],
    }, {
      net: "OUT", why: "the output line to the tap column, and up to the top feedback part",
      points: [
        { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
        { x: guide("T"), y: pin("u", "OUT") },
        { x: guide("T"), y: pin(top, net("OUT")) },
      ],
      require: [{ pin: ["u", "OUT"], dir: "right" }],
    }],
  };
}

// ---------------------------------------------------------------------------
// Oscillators.

/** Two grounded NPNs. Each timing capacitor must reach the OTHER transistor's base. */
function ledAstable(): Template {
  const slots: Template["slots"] = [];
  const interior: Rel[] = [];
  const trunks: NonNullable<Template["trunks"]> = [];
  const nets: Template["nets"] = { SUP: { kind: ["power"], port: true }, GND: { kind: ["ground"], port: true } };
  for (const [side, other] of [["L", "R"], ["R", "L"]] as const) {
    const left = side === "L";
    const q = "q" + side, load = "load" + side, led = "led" + side, bias = "bias" + side, cap = "cap" + side;
    const collector = "C" + side, base = "B" + side, nextBase = "B" + other, series = "series" + side;
    nets[collector] = nets[base] = { kind: ["signal"] };
    nets[series] = { kind: ["signal"], endpoints: 2 };
    slots.push(
      { name: q, types: ["npn"], role: "member", orient: left ? MIRROR : UPRIGHT, label: left ? "left" : "right",
        rank: { offset: 0 }, pins: [{ pin: "C", net: collector }, { pin: "B", net: base }, { pin: "E", net: "GND" }] },
      { name: cap, types: ["capacitor"], role: "member", symmetric: true, orient: { net: collector, dir: left ? "left" : "right" },
        label: left ? "above" : "below", pins: [{ pin: "1", net: collector }, { pin: "2", net: nextBase }] },
      { name: bias, types: ["resistor"], role: "member", symmetric: true, orient: { net: "SUP", dir: "up" },
        label: left ? "left" : "right", pins: [{ pin: "1", net: "SUP" }, { pin: "2", net: base }] },
      { name: load, types: ["resistor"], role: "member", symmetric: true, orient: { net: collector, dir: "down" },
        label: left ? "left" : "right", pins: [{ pin: "1", net: series }, { pin: "2", net: collector }] },
      { name: led, types: ["led"], role: "member", orient: { net: "SUP", dir: "up" }, label: left ? "left" : "right",
        pins: [{ pin: "A", net: "SUP" }, { pin: "K", net: series }] },
    );
    interior.push(
      rel("x", pin(load, net(collector)), "=", pin(q, "C"), 0, "collector load above the transistor"),
      rel("x", pin(led, "K"), "=", pin(q, "C"), 0, "LED in the collector column"),
      rel("y", pin(led, "K"), "=", pin(load, net(series)), -2, "LED immediately above its resistor"),
      rel("y", pin(load, net(collector)), "=", pin(q, "C"), -8, "room for the feedback taps"),
      rel("x", pin(bias, net(base)), left ? ">=" : "<=", pin(q, "B"), left ? 3 : -3, "base bias inside its transistor"),
      left ? rel("x", env(bias, "left"), ">=", env(load, "right"), 0, "clear the left load label")
        : rel("x", env(bias, "right"), "<=", env(load, "left"), 0, "clear the right load label"),
      rel("y", pin(bias, net(base)), "=", pin(load, net(collector)), -2, "bias resistors above the timing network"),
      rel("x", pin(cap, net(nextBase)), "=", pin("bias" + other, net(nextBase)), left ? -2 : 2, "capacitor leads into the opposite base column"),
      rel("y", pin(cap, net(collector)), "=", pin(q, "C"), left ? -6 : -2, "separate collector feedback rows"),
    );
    // The opposite capacitor joins this vertical bias wire at a T. Where it crosses
    // the other feedback row there is no junction.
    const biasPin = pin(bias, net(base)), basePin = pin(q, "B");
    trunks.push({ net: base, why: "base bias column turning into the transistor",
      points: [{ x: biasPin, y: biasPin, dy: 1 }, { x: biasPin, y: basePin }, { x: basePin, y: basePin, dx: left ? 1 : -1 }],
      require: [{ pin: [bias, net(base)], dir: "down" }, { pin: [q, "B"], dir: left ? "right" : "left" }] });
  }
  interior.push(
    rel("y", pin("qL", "B"), "=", pin("qR", "B"), 0, "transistors at the same height"),
    rel("x", pin("biasR", net("BR")), ">=", pin("biasL", net("BL")), 8, "two timing paths between the bias columns"),
    rel("x", env("capL", "left"), ">=", pin("biasL", net("BL")), 1, "left bias wire clears the upper capacitor label"),
    rel("x", pin("biasR", net("BR")), ">=", env("capR", "right"), 1, "right bias wire clears the lower capacitor label"),
  );
  return { id: "npn-led-astable", version: 1, priority: 3, summary: "Two grounded NPNs with LED loads and cross-coupled timing capacitors", nets, slots, interior, trunks };
}

/**
 * Relaxation oscillator (astable multivibrator): the timing resistor above the op-amp from the
 * output back to IN-, the timing capacitor hanging from that node on the left; the positive
 * feedback divider below, its upper resistor from the output back to IN+ and its lower resistor
 * hanging from that node. The output turns down at the tap column T and up at column U, further
 * on, so the output line has no four-way node.
 */
const RELAXATION_OSCILLATOR: Template = {
  id: "relaxation-oscillator", version: 1, priority: 2,
  summary: "op-amp; resistor OUT -> IN-, capacitor IN- -> reference; resistor OUT -> IN+, resistor IN+ -> reference",
  nets: { N: { kind: ["signal"] }, P: { kind: ["signal"] }, OUT: { kind: ["signal"] }, REF: {} },
  slots: [
    // Ranked: an oscillator has no input, so it is where the signal starts and its load goes after it.
    { name: "u", types: ["opamp"], role: "member", orient: UPRIGHT, rank: { offset: 0 },
      pins: [{ pin: "IN-", net: "N" }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "P" }] },
    { name: "rt", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
      pins: [{ pin: "1", net: "N" }, { pin: "2", net: "OUT" }] },
    { name: "ct", types: ["capacitor"], role: "member", symmetric: true, orient: { net: "N", dir: "up" }, label: "left",
      pins: [{ pin: "1", net: "N" }, { pin: "2", net: "REF" }] },
    { name: "rp", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" }, label: "below",
      pins: [{ pin: "1", net: "P" }, { pin: "2", net: "OUT" }] },
    { name: "rh", types: ["resistor"], role: "member", symmetric: true, orient: { net: "P", dir: "up" }, label: "left",
      pins: [{ pin: "1", net: "P" }, { pin: "2", net: "REF" }] },
  ],
  interior: [
    rel("x", guide("SP"), "=", pin("u", "IN+"), -2, "IN+ node column SP = IN+.x - 2"),
    rel("x", guide("SP"), ">=", env("ct", "right"), 3, "timing capacitor and its ground symbol well left of the IN+ node column"),
    rel("x", env("rh", "left"), ">=", env("ct", "right"), 1, "lower divider resistor and its label right of the timing capacitor"),
    rel("x", guide("SN"), "=", pin("ct", net("N")), 0, "IN- node column SN: the timing capacitor hangs from it"),
    rel("y", pin("ct", net("N")), "=", pin("u", "IN-"), 2, "timing capacitor hangs from the IN- line"),
    rel("x", pin("rt", net("N")), ">=", guide("SN"), 2, "timing resistor starts 2 G right of its node"),
    rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
    rel("x", guide("U"), "=", guide("T"), 2, "column U 2 G right of the tap: no four-way node on the output line"),
    rel("x", pin("rt", net("OUT")), "<=", guide("U"), -1, "timing resistor ends left of its column"),
    rel("x", env("rt", "right"), "<=", guide("U"), -1, "timing resistor label clear of its column"),
    rel("y", env("rt", "bottom"), "<=", env("u", "top"), -1, "timing resistor above the op-amp, 1 G corridor"),
    rel("x", pin("rp", net("P")), ">=", guide("SP"), 2, "feedback resistor starts 2 G right of the IN+ node"),
    rel("x", pin("rp", net("OUT")), "<=", guide("T"), -1, "feedback resistor ends left of the tap"),
    rel("x", env("rp", "right"), "<=", guide("T"), -1, "feedback resistor label clear of the tap column"),
    rel("y", env("rp", "top"), ">=", env("u", "bottom"), 1, "feedback resistor below the op-amp, 1 G corridor"),
    rel("x", pin("rh", net("P")), "=", guide("SP"), 0, "lower divider resistor below the IN+ node"),
    rel("y", pin("rh", net("P")), "=", pin("rp", net("P")), 2, "lower divider resistor hangs from the feedback row"),
    rel("x", env("rp", "left"), ">=", box("rh", "right"), 1, "feedback resistor and its label right of the lower divider resistor"),
  ],
  boundary: [["u", "OUT"], ["ct", { net: "REF" }], ["rh", { net: "REF" }]],
  reserve: ["U"],
  trunks: [{
    net: "N", why: "the IN- node: one vertical conductor from the timing resistor row down to the capacitor",
    points: [
      { x: pin("rt", net("N")), dx: -1, y: pin("rt", net("N")) },
      { x: guide("SN"), y: pin("rt", net("N")) },
      { x: guide("SN"), y: pin("ct", net("N")), dy: -1 },
    ],
    require: [{ pin: ["rt", { net: "N" }], dir: "left" }, { pin: ["ct", { net: "N" }], dir: "up" }],
  }, {
    net: "N", why: "the IN- line from the node column to the pin",
    points: [{ x: guide("SN"), y: pin("u", "IN-") }, { x: pin("u", "IN-"), dx: -1, y: pin("u", "IN-") }],
    require: [{ pin: ["u", "IN-"], dir: "left" }],
  }, {
    net: "P", why: "the IN+ node: one vertical conductor at SP from IN+ down to the feedback row",
    points: [{ x: guide("SP"), y: pin("u", "IN+") }, { x: guide("SP"), y: pin("rp", net("P")) }],
  }, {
    net: "OUT", why: "the output line past the tap column, and up to the timing resistor",
    points: [
      { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
      { x: guide("U"), y: pin("u", "OUT") },
      { x: guide("U"), y: pin("rt", net("OUT")) },
      { x: pin("rt", net("OUT")), dx: 1, y: pin("rt", net("OUT")) },
    ],
    require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["rt", { net: "OUT" }], dir: "right" }],
  }, {
    net: "OUT", why: "the tap column down to the feedback resistor",
    points: [{ x: guide("T"), y: pin("u", "OUT") }, { x: guide("T"), y: pin("rp", net("OUT")) }, { x: pin("rp", net("OUT")), dx: 1, y: pin("rp", net("OUT")) }],
    require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["rp", { net: "OUT" }], dir: "right" }],
  }],
};

/**
 * Wien bridge oscillator. The op-amp is turned so IN+ is on top. The gain network hangs below, as
 * in the non-inverting amplifier. The series resistor and capacitor run in one line above the
 * op-amp, from column P (the IN+ node) to column U on the output line; the parallel resistor and
 * capacitor hang side by side from the IN+ line. `first`: the series part on the IN+ side.
 */
function wienBridge(first: "resistor" | "capacitor"): Template {
  const second = first === "resistor" ? "capacitor" : "resistor";
  return {
    id: `wien-bridge-${first === "resistor" ? "rc" : "cr"}`, version: 1, priority: 2,
    summary: `Wien bridge oscillator: a ${first} then a ${second} in series from IN+ to OUT, a resistor and a capacitor from IN+ to the reference, and a non-inverting gain network`,
    nets: { P: { kind: ["signal"] }, M: { kind: ["signal"], endpoints: 2 }, FB: { kind: ["signal"] }, OUT: { kind: ["signal"] }, REF: {} },
    slots: [
      // Ranked: an oscillator has no input, so it is where the signal starts and its load goes after it.
      { name: "u", types: ["opamp"], role: "member", orient: PLUS_UP, rank: { offset: 0 },
        pins: [{ pin: "IN-", net: "FB" }, { pin: "OUT", net: "OUT" }, { pin: "IN+", net: "P" }] },
      { name: "sa", types: [first], role: "member", symmetric: true, orient: { net: "M", dir: "right" },
        pins: [{ pin: "1", net: "P" }, { pin: "2", net: "M" }] },
      { name: "sb", types: [second], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
        pins: [{ pin: "1", net: "M" }, { pin: "2", net: "OUT" }] },
      { name: "rp", types: ["resistor"], role: "member", symmetric: true, orient: { net: "P", dir: "up" }, label: "left",
        pins: [{ pin: "1", net: "P" }, { pin: "2", net: "REF" }] },
      { name: "cp", types: ["capacitor"], role: "member", symmetric: true, orient: { net: "P", dir: "up" }, label: "right",
        pins: [{ pin: "1", net: "P" }, { pin: "2", net: "REF" }] },
      { name: "rf", types: ["resistor"], role: "member", symmetric: true, orient: { net: "OUT", dir: "right" },
        pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "OUT" }] },
      { name: "rg", types: ["resistor"], role: "member", symmetric: true, orient: { net: "FB", dir: "up" },
        pins: [{ pin: "1", net: "FB" }, { pin: "2", net: "REF" }] },
    ],
    interior: [
      // The IN+ line: column P, the parallel resistor under it, the parallel capacitor, IN+.
      rel("x", guide("P"), "=", pin("rp", net("P")), 0, "column P: the parallel resistor hangs under it"),
      rel("x", pin("cp", net("P")), ">=", pin("rp", net("P")), 4, "parallel capacitor right of the parallel resistor"),
      rel("x", env("cp", "left"), ">=", env("rp", "right"), 1, "parallel parts clear of each other"),
      rel("y", pin("rp", net("P")), "=", pin("u", "IN+"), 2, "parallel resistor hangs from the IN+ line"),
      rel("y", pin("cp", net("P")), "=", pin("u", "IN+"), 2, "parallel capacitor hangs from the IN+ line"),
      rel("x", pin("u", "IN+"), ">=", pin("cp", net("P")), 4, "IN+ at least 4 G right of the parallel capacitor"),
      rel("x", guide("S"), "=", pin("u", "IN-"), -2, "node column S = IN-.x - 2"),
      rel("x", guide("S"), ">=", env("cp", "right"), 1, "parallel capacitor and its label clear of the node column"),
      // The series pair in one line above the op-amp.
      rel("x", pin("sa", net("P")), ">=", guide("P"), 2, "series pair starts 2 G right of column P"),
      rel("x", pin("sb", net("M")), "=", pin("sa", net("M")), 2, "a short wire between the series parts"),
      rel("y", pin("sb", net("M")), "=", pin("sa", net("M")), 0, "series parts in one line"),
      rel("x", env("sb", "left"), ">=", env("sa", "right"), 1, "series labels clear of each other"),
      rel("y", env("sa", "bottom"), "<=", env("u", "top"), -1, "series pair above the op-amp, 1 G corridor"),
      rel("y", env("sb", "bottom"), "<=", env("u", "top"), -1, "series pair above the op-amp, 1 G corridor"),
      rel("x", guide("T"), ">=", pin("u", "OUT"), 2, "output tap column T >= OUT.x + 2"),
      rel("x", guide("U"), "=", guide("T"), 2, "column U 2 G right of the tap: no four-way node on the output line"),
      rel("x", pin("sb", net("OUT")), "<=", guide("U"), -1, "series pair ends left of its column"),
      rel("x", env("sb", "right"), "<=", guide("U"), -1, "series label clear of its column"),
      // The gain network, as in the non-inverting amplifier.
      rel("x", pin("rg", net("FB")), "=", guide("S"), 0, "ground resistor below the feedback node"),
      rel("x", env("rg", "left"), ">=", env("cp", "right"), 1, "ground resistor right of the parallel capacitor"),
      rel("x", pin("rf", net("FB")), ">=", guide("S"), 2, "feedback resistor starts 2 G right of the node"),
      rel("x", pin("rf", net("OUT")), "<=", guide("T"), -1, "feedback resistor ends left of the tap"),
      rel("x", env("rf", "right"), "<=", guide("T"), -1, "feedback label clear of the tap column"),
      rel("y", env("rf", "top"), ">=", env("u", "bottom"), 1, "feedback resistor below the op-amp, 1 G corridor"),
      rel("y", env("rg", "top"), ">=", env("rf", "bottom"), 1, "ground resistor below the feedback row"),
    ],
    boundary: [["u", "OUT"], ["rp", { net: "REF" }], ["cp", { net: "REF" }], ["rg", { net: "REF" }]],
    reserve: ["U"],
    trunks: [{
      net: "P", why: "column P: from the series pair down to the IN+ line and the parallel resistor",
      points: [
        { x: pin("sa", net("P")), dx: -1, y: pin("sa", net("P")) },
        { x: guide("P"), y: pin("sa", net("P")) },
        { x: guide("P"), y: pin("rp", net("P")), dy: -1 },
      ],
      require: [{ pin: ["sa", { net: "P" }], dir: "left" }, { pin: ["rp", { net: "P" }], dir: "up" }],
    }, {
      net: "P", why: "the IN+ line from column P to the pin",
      points: [{ x: guide("P"), y: pin("u", "IN+") }, { x: pin("u", "IN+"), dx: -1, y: pin("u", "IN+") }],
      require: [{ pin: ["u", "IN+"], dir: "left" }],
    }, {
      net: "FB", why: "the feedback node: one vertical conductor at S from IN- to the feedback row",
      points: [{ x: guide("S"), y: pin("u", "IN-") }, { x: guide("S"), y: pin("rf", net("FB")) }],
    }, {
      net: "OUT", why: "the output line past the tap column, and up to the series pair",
      points: [
        { x: pin("u", "OUT"), dx: 1, y: pin("u", "OUT") },
        { x: guide("U"), y: pin("u", "OUT") },
        { x: guide("U"), y: pin("sb", net("OUT")) },
        { x: pin("sb", net("OUT")), dx: 1, y: pin("sb", net("OUT")) },
      ],
      require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["sb", { net: "OUT" }], dir: "right" }],
    }, {
      net: "OUT", why: "the tap column down to the feedback resistor",
      points: [{ x: guide("T"), y: pin("u", "OUT") }, { x: guide("T"), y: pin("rf", net("OUT")) }, { x: pin("rf", net("OUT")), dx: 1, y: pin("rf", net("OUT")) }],
      require: [{ pin: ["u", "OUT"], dir: "right" }, { pin: ["rf", { net: "OUT" }], dir: "right" }],
    }],
  };
}

/** All templates; the engine sorts matches by priority. Decoupling is handled by src/layout/decoupling.ts. */
export const TEMPLATES: readonly Template[] = [
  OPAMP_INVERTING, OPAMP_NONINVERTING,
  invertingStage("opamp-inverting-lowpass", "resistor", true, "op-amp; resistor and capacitor side by side between OUT and IN-; at least one resistor into IN-"),
  invertingStage("opamp-integrator", "capacitor", false, "op-amp; capacitor between OUT and IN-; at least one resistor into IN-"),
  sallenKey("lowpass", false), sallenKey("lowpass", true), sallenKey("highpass", false), sallenKey("highpass", true),
  ledAstable(), RELAXATION_OSCILLATOR, wienBridge("resistor"), wienBridge("capacitor"),
  hBridge("pmos", "nmos"), hBridge("pnp", "npn"), diffPair("npn", "pnp"), diffPair("nmos", "pmos"), BRIDGE_RECTIFIER, I2C,
  lowSide("npn", "relay"), lowSide("nmos", "relay"), lowSide("npn", "two-pin"), lowSide("nmos", "two-pin"),
  DIVIDER, PULL_UP, PULL_DOWN, LED_VERTICAL, LED_HORIZONTAL,
];
