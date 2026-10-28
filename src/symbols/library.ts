// Built-in symbols (SPEC 7). Drawn for this project ("source": "original").
// Units are grid units (1 G = 10 SVG units). Pin anchors sit at the outer end of each lead.

import { gridBox, inClosedBox, step, xformBox, xformDir, xformPt, type Box, type Dir, type Orient, type Pt, type Rot } from "../geom/geom.js";
import type { PinDef, Role } from "../core/model.js";

export interface SymPin extends PinDef { at: Pt; dir: Dir }
export interface Graphic { d: string; fill?: "none" | "stroke" }
/**
 * Fixed text drawn with the symbol (terminal numbers, header pin names), centred on `at`
 * in local units. Text stays upright in every orientation; only its centre is transformed.
 */
export interface SymText { at: Pt; text: string; size: number; pin: string }

export interface SymbolDef {
  id: string;
  version: number;
  refPrefix: string;
  source: "original";
  pins: SymPin[];
  align: Pt;
  graphics: Graphic[];
  /** Artwork bounds in local units (fractional allowed). */
  art: Box;
  labelPrefer: Array<"above" | "below" | "right" | "left">;
  kind: "two-pin" | "source" | "opamp" | "ic" | "port" | "transistor" | "potentiometer" | "relay" | "header";
  texts?: SymText[];
}

const pin = (number: string, name: string, at: Pt, dir: Dir, role: Role, extra: Partial<PinDef> = {}): SymPin =>
  ({ number, name, at, dir, role, ...extra });

const RESISTOR: SymbolDef = {
  id: "resistor", version: 1, refPrefix: "R", source: "original", kind: "two-pin",
  pins: [pin("1", "1", [0, 0], "left", "passive", { chain: "in" }), pin("2", "2", [6, 0], "right", "passive", { chain: "out" })],
  align: [3, 0],
  graphics: [{ d: "M0 0 H1.5 L1.75 -0.5 L2.25 0.5 L2.75 -0.5 L3.25 0.5 L3.75 -0.5 L4.25 0.5 L4.5 0 H6" }],
  art: { x: 0, y: -0.5, w: 6, h: 1 },
  labelPrefer: ["above", "below", "right", "left"],
};

const CAPACITOR: SymbolDef = {
  id: "capacitor", version: 1, refPrefix: "C", source: "original", kind: "two-pin",
  pins: [pin("1", "1", [0, 0], "left", "passive", { chain: "in" }), pin("2", "2", [4, 0], "right", "passive", { chain: "out" })],
  align: [2, 0],
  graphics: [{ d: "M0 0 H1.7 M1.7 -0.9 V0.9 M2.3 -0.9 V0.9 M2.3 0 H4" }],
  art: { x: 0, y: -0.9, w: 4, h: 1.8 },
  labelPrefer: ["above", "below", "right", "left"],
};

const LED: SymbolDef = {
  id: "led", version: 1, refPrefix: "D", source: "original", kind: "two-pin",
  pins: [
    pin("A", "anode", [0, 0], "left", "passive", { aliases: ["a", "+", "1"], chain: "in" }),
    pin("K", "cathode", [4, 0], "right", "passive", { aliases: ["k", "-", "2"], chain: "out" }),
  ],
  align: [2, 0],
  graphics: [
    { d: "M0 0 H1.3 M2.7 0 H4 M2.7 -0.75 V0.75" },
    { d: "M1.3 -0.75 L2.7 0 L1.3 0.75 Z", fill: "stroke" },
    { d: "M2.0 -1.0 L2.6 -1.6 M2.3 -1.6 H2.6 V-1.3 M2.6 -0.9 L3.2 -1.5 M2.9 -1.5 H3.2 V-1.2" },
  ],
  art: { x: 0, y: -1.6, w: 4, h: 2.35 },
  labelPrefer: ["below", "above", "right", "left"],
};

const BATTERY: SymbolDef = {
  id: "battery", version: 1, refPrefix: "B", source: "original", kind: "source",
  pins: [
    pin("+", "+", [0, 0], "left", "power_out", { aliases: ["pos", "p"], chain: "out" }),
    pin("-", "-", [4, 0], "right", "power_out", { aliases: ["neg", "n"], chain: "in" }),
  ],
  align: [2, 0],
  graphics: [
    { d: "M0 0 H1.7 M1.7 -1.0 V1.0 M2.3 0 H4" },
    { d: "M2.15 -0.5 H2.45 V0.5 H2.15 Z", fill: "stroke" },
    { d: "M0.8 -1.2 V-0.6 M0.5 -0.9 H1.1" },
  ],
  art: { x: 0, y: -1.2, w: 4, h: 2.2 },
  labelPrefer: ["left", "right", "above", "below"],
};

const VSOURCE: SymbolDef = {
  id: "vsource", version: 1, refPrefix: "V", source: "original", kind: "source",
  pins: [
    pin("+", "+", [0, 0], "left", "output", { aliases: ["pos", "p"], chain: "out" }),
    pin("-", "-", [6, 0], "right", "output", { aliases: ["neg", "n"], chain: "in" }),
  ],
  align: [3, 0],
  graphics: [
    { d: "M0 0 H1.8 M4.2 0 H6" },
    { d: "M1.8 0 A1.2 1.2 0 1 1 4.2 0 A1.2 1.2 0 1 1 1.8 0 Z" },
    { d: "M2.2 -0.3 V0.3 M2.5 0 H1.9 M3.6 -0.3 V0.3" },
  ],
  art: { x: 0, y: -1.2, w: 6, h: 2.4 },
  labelPrefer: ["left", "right", "above", "below"],
};

const OPAMP: SymbolDef = {
  id: "opamp", version: 1, refPrefix: "U", source: "original", kind: "opamp",
  pins: [
    pin("2", "IN-", [0, -1], "left", "input", { aliases: ["-", "inm", "INM"] }),
    pin("3", "IN+", [0, 1], "left", "input", { aliases: ["+", "inp", "INP"] }),
    pin("1", "OUT", [6, 0], "right", "output", { aliases: ["out", "o"] }),
  ],
  align: [3, 0],
  graphics: [
    { d: "M0 -1 H1 M0 1 H1 M5 0 H6" },
    { d: "M1 -2.5 L5 0 L1 2.5 Z" },
    { d: "M1.4 -1 H2.0 M1.4 1 H2.0 M1.7 0.7 V1.3" },
  ],
  art: { x: 0, y: -2.5, w: 6, h: 5 },
  labelPrefer: ["above", "below", "right", "left"],
};

const GROUND: SymbolDef = {
  id: "ground", version: 1, refPrefix: "#", source: "original", kind: "port",
  pins: [pin("1", "1", [0, 0], "up", "ground")],
  align: [0, 0],
  graphics: [{ d: "M0 0 V1 M-1 1 H1 M-0.6 1.4 H0.6 M-0.2 1.8 H0.2" }],
  art: { x: -1, y: 0, w: 2, h: 1.8 },
  labelPrefer: ["right"],
};

const SUPPLY: SymbolDef = {
  id: "supply", version: 1, refPrefix: "#", source: "original", kind: "port",
  pins: [pin("1", "1", [0, 0], "down", "power_in")],
  align: [0, 0],
  graphics: [{ d: "M0 0 V-1 M-1 -1 H1" }],
  art: { x: -1, y: -1, w: 2, h: 1 },
  labelPrefer: ["above"],
};

// ---------------------------------------------------------------------------
// Phase 0b symbols (SPEC 7.2). Pin inventories follow phase0/proposed-symbols.json.

/** Number with at most 2 decimals and no "-0", for computed path data. */
const n2 = (v: number): string => { const r = Math.round(v * 100) / 100; return String(Object.is(r, -0) ? 0 : r); };

/** Filled arrowhead on the segment from -> to, tip at fraction `t` of the way, pointing towards `to`. */
function arrowHead(from: Pt, to: Pt, t: number, len = 0.6, half = 0.28): string {
  const dx = to[0] - from[0], dy = to[1] - from[1], l = Math.hypot(dx, dy);
  const ux = dx / l, uy = dy / l;
  const tip: Pt = [from[0] + dx * t, from[1] + dy * t];
  const bx = tip[0] - ux * len, by = tip[1] - uy * len;
  return `M${n2(tip[0])} ${n2(tip[1])} L${n2(bx - uy * half)} ${n2(by + ux * half)} L${n2(bx + uy * half)} ${n2(by - ux * half)} Z`;
}

const DIODE: SymbolDef = {
  id: "diode", version: 1, refPrefix: "D", source: "original", kind: "two-pin",
  pins: [
    pin("A", "anode", [0, 0], "left", "passive", { aliases: ["a", "+"], chain: "in" }),
    pin("K", "cathode", [4, 0], "right", "passive", { aliases: ["k", "-"], chain: "out" }),
  ],
  align: [2, 0],
  graphics: [
    { d: "M0 0 H1.3 M2.7 0 H4 M2.7 -0.75 V0.75" },
    { d: "M1.3 -0.75 L2.7 0 L1.3 0.75 Z", fill: "stroke" },
  ],
  art: { x: 0, y: -0.75, w: 4, h: 1.5 },
  labelPrefer: ["above", "below", "right", "left"],
};

const POLCAP: SymbolDef = {
  id: "polarised-capacitor", version: 1, refPrefix: "C", source: "original", kind: "two-pin",
  pins: [
    pin("+", "+", [0, 0], "left", "passive", { aliases: ["pos", "p"], chain: "in" }),
    pin("-", "-", [4, 0], "right", "passive", { aliases: ["neg", "n"], chain: "out" }),
  ],
  align: [2, 0],
  graphics: [
    // Straight plate is "+", curved plate is "-" (IEEE 315).
    { d: "M0 0 H1.7 M1.7 -0.9 V0.9 M2.3 0 H4" },
    { d: "M2.6 -0.9 A1.5 1.5 0 0 0 2.6 0.9" },
    { d: "M0.65 -1.0 H1.25 M0.95 -1.3 V-0.7" },
  ],
  art: { x: 0, y: -1.3, w: 4, h: 2.2 },
  labelPrefer: ["above", "below", "right", "left"],
};

const POTENTIOMETER: SymbolDef = {
  id: "potentiometer", version: 1, refPrefix: "RV", source: "original", kind: "potentiometer",
  pins: [
    pin("1", "1", [0, 0], "left", "passive"),
    pin("2", "wiper", [3, -2], "up", "passive", { aliases: ["W", "w"] }),
    pin("3", "3", [6, 0], "right", "passive"),
  ],
  align: [3, 0],
  graphics: [
    { d: "M0 0 H1.5 L1.75 -0.5 L2.25 0.5 L2.75 -0.5 L3.25 0.5 L3.75 -0.5 L4.25 0.5 L4.5 0 H6" },
    { d: "M3 -2 V-1.2" },
    { d: arrowHead([3, -2], [3, -0.6], 1), fill: "stroke" },
  ],
  art: { x: 0, y: -2, w: 6, h: 2.5 },
  labelPrefer: ["below", "above", "right", "left"],
};

/** Bipolar transistor: base left, the two other leads leave up and down at x = 4. */
function bjt(id: "npn" | "pnp"): SymbolDef {
  const p = id === "pnp";
  const emitterDiag: [Pt, Pt] = p ? [[4, -1.5], [1.8, -0.5]] : [[1.8, 0.5], [4, 1.5]];
  const names: Record<string, string> = { B: "base", C: "collector", E: "emitter" };
  const mk = (n: string, at: Pt, dir: Dir) => pin(n, names[n]!, at, dir, "passive", { aliases: [n.toLowerCase()] });
  return {
    id, version: 1, refPrefix: "Q", source: "original", kind: "transistor",
    pins: [mk("B", [0, 0], "left"), mk("C", p ? [4, 3] : [4, -3], p ? "down" : "up"), mk("E", p ? [4, -3] : [4, 3], p ? "up" : "down")],
    align: [0, 0],
    graphics: [
      { d: "M0 0 H1.8 M1.8 -1.1 V1.1 M1.8 -0.5 L4 -1.5 V-3 M1.8 0.5 L4 1.5 V3" },
      { d: "M1 0 A2 2 0 1 1 5 0 A2 2 0 1 1 1 0 Z" },
      // NPN: arrow on the emitter pointing out; PNP: pointing in, towards the base.
      { d: arrowHead(emitterDiag[0], emitterDiag[1], p ? 0.62 : 0.85), fill: "stroke" },
    ],
    art: { x: 0, y: -3, w: 5, h: 6 },
    labelPrefer: ["right", "left", "above", "below"],
  };
}

/** Enhancement MOSFET, three terminals, body tied to source: gate left, drain and source up and down at x = 4. */
function mosfet(id: "nmos" | "pmos"): SymbolDef {
  const p = id === "pmos";
  const sy = p ? -1 : 1; // row where the source meets the channel
  const names: Record<string, string> = { G: "gate", D: "drain", S: "source" };
  const mk = (n: string, at: Pt, dir: Dir) => pin(n, names[n]!, at, dir, "passive", { aliases: [n.toLowerCase()] });
  return {
    id, version: 1, refPrefix: "Q", source: "original", kind: "transistor",
    pins: [mk("G", [0, 0], "left"), mk("D", [4, -3 * sy], sy > 0 ? "up" : "down"), mk("S", [4, 3 * sy], sy > 0 ? "down" : "up")],
    align: [0, 0],
    graphics: [
      { d: `M0 0 H1.5 M1.5 -1.1 V1.1 M2.1 -1.4 V-0.6 M2.1 -0.4 V0.4 M2.1 0.6 V1.4 M2.1 -1 H4 V-3 M2.1 1 H4 V3 M2.1 0 H4 V${sy}` },
      { d: "M1 0 A2 2 0 1 1 5 0 A2 2 0 1 1 1 0 Z" },
      // N-channel: arrow into the channel; P-channel: out of it.
      { d: p ? arrowHead([2.1, 0], [4, 0], 0.75) : arrowHead([4, 0], [2.1, 0], 0.95), fill: "stroke" },
    ],
    art: { x: 0, y: -3, w: 5, h: 6 },
    labelPrefer: ["right", "left", "above", "below"],
  };
}

const twoPinPassive = (aliases1?: string[], aliases2?: string[], chain = true): SymPin[] => [
  pin("1", "1", [0, 0], "left", "passive", { ...(aliases1 ? { aliases: aliases1 } : {}), ...(chain ? { chain: "in" as const } : {}) }),
  pin("2", "2", [4, 0], "right", "passive", { ...(aliases2 ? { aliases: aliases2 } : {}), ...(chain ? { chain: "out" as const } : {}) }),
];

const SPST: SymbolDef = {
  id: "spst", version: 1, refPrefix: "SW", source: "original", kind: "two-pin",
  pins: twoPinPassive(),
  align: [2, 0],
  graphics: [
    { d: "M0 0 H0.8 M3.2 0 H4" },
    { d: "M0.8 0 A0.2 0.2 0 1 1 1.2 0 A0.2 0.2 0 1 1 0.8 0 Z M2.8 0 A0.2 0.2 0 1 1 3.2 0 A0.2 0.2 0 1 1 2.8 0 Z" },
    { d: "M1.15 -0.12 L3.15 -1.1" },
  ],
  art: { x: 0, y: -1.1, w: 4, h: 1.3 },
  labelPrefer: ["above", "below", "right", "left"],
};

const PUSHBUTTON: SymbolDef = {
  id: "pushbutton", version: 1, refPrefix: "SW", source: "original", kind: "two-pin",
  pins: twoPinPassive(),
  align: [2, 0],
  graphics: [
    { d: "M0 0 H0.8 M3.2 0 H4" },
    { d: "M0.8 0 A0.2 0.2 0 1 1 1.2 0 A0.2 0.2 0 1 1 0.8 0 Z M2.8 0 A0.2 0.2 0 1 1 3.2 0 A0.2 0.2 0 1 1 2.8 0 Z" },
    { d: "M0.7 -0.6 H3.3 M2 -0.6 V-1.4 M1.4 -1.4 H2.6" },
  ],
  art: { x: 0, y: -1.4, w: 4, h: 1.6 },
  labelPrefer: ["below", "above", "right", "left"],
};

const BUZZER: SymbolDef = {
  id: "buzzer", version: 1, refPrefix: "BZ", source: "original", kind: "two-pin",
  pins: [
    pin("+", "+", [0, 0], "left", "passive", { aliases: ["pos", "p"], chain: "in" }),
    pin("-", "-", [6, 0], "right", "passive", { aliases: ["neg", "n"], chain: "out" }),
  ],
  align: [3, 0],
  graphics: [
    // Leads end at the two sides of a box body, so nothing conductor-like runs between them;
    // the sounder dome stands on the box.
    { d: "M0 0 H1.5 M4.5 0 H6" },
    { d: "M1.5 -0.7 H4.5 V0.7 H1.5 Z" },
    { d: "M1.9 -0.7 A1.1 1.1 0 0 1 4.1 -0.7" },
    { d: "M0.45 -0.8 H1.05 M0.75 -1.1 V-0.5" },
  ],
  art: { x: 0, y: -1.8, w: 6, h: 2.5 },
  labelPrefer: ["below", "above", "right", "left"],
};

const MOTOR: SymbolDef = {
  id: "motor", version: 1, refPrefix: "M", source: "original", kind: "two-pin",
  pins: [
    pin("1", "1", [0, 0], "left", "passive", { aliases: ["+"] }),
    pin("2", "2", [6, 0], "right", "passive", { aliases: ["-"] }),
  ],
  align: [3, 0],
  graphics: [
    { d: "M0 0 H1.5 M4.5 0 H6" },
    { d: "M1.5 0 A1.5 1.5 0 1 1 4.5 0 A1.5 1.5 0 1 1 1.5 0 Z" },
    // The letter M, drawn as strokes (no text in symbol graphics, SPEC 7.1).
    { d: "M2.4 0.6 V-0.6 L3 0.15 L3.6 -0.6 V0.6" },
  ],
  art: { x: 0, y: -1.5, w: 6, h: 3 },
  labelPrefer: ["above", "below", "right", "left"],
};

const FUSE: SymbolDef = {
  id: "fuse", version: 1, refPrefix: "F", source: "original", kind: "two-pin",
  pins: [pin("1", "1", [0, 0], "left", "passive", { chain: "in" }), pin("2", "2", [6, 0], "right", "passive", { chain: "out" })],
  align: [3, 0],
  graphics: [{ d: "M0 0 H1.5 A0.75 0.75 0 0 1 3 0 A0.75 0.75 0 0 0 4.5 0 H6" }],
  art: { x: 0, y: -0.75, w: 6, h: 1.5 },
  labelPrefer: ["above", "below", "right", "left"],
};

const ACSOURCE: SymbolDef = {
  id: "ac-source", version: 1, refPrefix: "V", source: "original", kind: "source",
  pins: [pin("1", "1", [0, 0], "left", "passive"), pin("2", "2", [6, 0], "right", "passive")],
  align: [3, 0],
  graphics: [
    { d: "M0 0 H1.8 M4.2 0 H6" },
    { d: "M1.8 0 A1.2 1.2 0 1 1 4.2 0 A1.2 1.2 0 1 1 1.8 0 Z" },
    // One sine period, drawn across the pin axis so it reads upright when the source stands vertical.
    { d: "M3 -0.7 A0.35 0.35 0 0 0 3 0 A0.35 0.35 0 0 1 3 0.7" },
  ],
  art: { x: 0, y: -1.2, w: 6, h: 2.4 },
  labelPrefer: ["left", "right", "above", "below"],
};

/**
 * Relay, one symbol: coil (A1 top, A2 bottom) and one changeover contact (EN 50005: 11 common
 * at the bottom, 12 normally closed and 14 normally open at the top), with the terminal numbers drawn.
 */
const RELAY: SymbolDef = {
  id: "relay", version: 1, refPrefix: "K", source: "original", kind: "relay",
  pins: [
    pin("A1", "A1", [2, -3], "up", "passive"),
    pin("A2", "A2", [2, 3], "down", "passive"),
    pin("11", "COM", [6, 3], "down", "passive"),
    pin("12", "NC", [5, -3], "up", "passive"),
    pin("14", "NO", [7, -3], "up", "passive"),
  ],
  align: [2, 0],
  graphics: [
    { d: "M2 -3 V-1.2 M2 1.2 V3 M1 -1.2 H3 V1.2 H1 Z" },
    // Contact at rest: the blade from common touches the normally closed contact.
    { d: "M5 -3 V-1 H5.6 M7 -3 V-1 H6.4 M6 3 V1 L5.45 -1" },
    // Mechanical link from the coil to the blade (dashed).
    { d: "M3.3 0 H3.8 M4.2 0 H4.7 M5.1 0 H5.55" },
  ],
  art: { x: 0, y: -3, w: 7, h: 6 },
  labelPrefer: ["right", "left", "above", "below"],
  texts: [
    { at: [1.1, -2.2], text: "A1", size: 8, pin: "A1" },
    { at: [1.1, 2.2], text: "A2", size: 8, pin: "A2" },
    { at: [4.3, -2.2], text: "12", size: 8, pin: "12" },
    { at: [6.3, -2.2], text: "14", size: 8, pin: "14" },
    { at: [5.3, 2.2], text: "11", size: 8, pin: "11" },
  ],
};

export const BUILTIN: Record<string, SymbolDef> = Object.fromEntries(
  [RESISTOR, CAPACITOR, LED, BATTERY, VSOURCE, OPAMP, GROUND, SUPPLY,
    DIODE, POLCAP, POTENTIOMETER, bjt("npn"), bjt("pnp"), mosfet("nmos"), mosfet("pmos"),
    SPST, PUSHBUTTON, BUZZER, MOTOR, RELAY, FUSE, ACSOURCE].map((s) => [s.id, s]),
);

/** Part types whose pins are declared on the part (SPEC 6.2 `pins`), with a generated symbol. */
export const HEADER = "header";

/**
 * Header connector (SPEC 7.2): one vertical column of the part's own pins, 2 G apart,
 * leaving to the right. Pin names are drawn inside the body and pin numbers over the leads.
 */
export function headerSymbol(pins: PinDef[], measureText: (text: string, size: number) => number): SymbolDef {
  const NAME = 10, NUM = 8;
  const bw = Math.max(2, Math.ceil(Math.max(0, ...pins.map((p) => measureText(p.name, NAME))) + 1));
  const lead = Math.max(2, Math.ceil(Math.max(0, ...pins.filter((p) => p.number !== p.name).map((p) => measureText(p.number, NUM))) + 1));
  const W = bw + lead;
  const H = Math.max(1, pins.length) * 2;
  const at = (i: number): Pt => [W, 2 * i + 1];
  return {
    id: HEADER, version: 1, refPrefix: "J", source: "original", kind: "header",
    pins: pins.map((p, i) => ({ ...p, at: at(i), dir: "right" as const })),
    align: [W, 1],
    graphics: [
      { d: `M0 0 H${bw} V${H} H0 Z` },
      ...(pins.length ? [{ d: pins.map((_, i) => `M${bw} ${2 * i + 1} H${W}`).join(" ") }] : []),
    ],
    art: { x: 0, y: 0, w: W, h: H },
    labelPrefer: ["above", "below", "left", "right"],
    texts: pins.flatMap((p, i): SymText[] => [
      { at: [bw / 2, 2 * i + 1], text: p.name, size: NAME, pin: p.number },
      ...(p.number !== p.name ? [{ at: [bw + lead / 2, 2 * i + 0.45] as Pt, text: p.number, size: NUM, pin: p.number }] : []),
    ]),
  };
}

/**
 * Generated box for chips and modules (SPEC 7.3). Side pins are 2 G apart; top and bottom
 * pins are `pitch` G apart, wide enough that their horizontal names do not run together.
 */
export function icSymbol(
  sides: { left: PinDef[]; right: PinDef[]; top: PinDef[]; bottom: PinDef[] }, innerWidth: number, pitch = 2,
  topGap?: (a: PinDef, b: PinDef) => number,
): SymbolDef {
  const rows = Math.max(sides.left.length, sides.right.length, 1);
  // Top pins sit `pitch` apart, or further where `topGap` asks for room between two neighbours.
  const topAt = sides.top.map((_, i) => i * pitch);
  for (let i = 1; i < topAt.length; i++) topAt[i] = topAt[i - 1]! + Math.max(pitch, topGap?.(sides.top[i - 1]!, sides.top[i]!) ?? 0);
  const topSpan = topAt.length ? topAt[topAt.length - 1]! : -pitch;
  const span = Math.max(topSpan, (sides.bottom.length - 1) * pitch);
  const W = Math.max(innerWidth, span + 4, 6) + 2; // +2 for the 1 G leads on each side
  const y0 = sides.top.length ? 4 : 2;                 // room for top pin names inside the box
  const H = y0 + (rows - 1) * 2 + (sides.bottom.length ? 4 : 2);
  const pins: SymPin[] = [];
  sides.left.forEach((p, i) => pins.push({ ...p, at: [0, y0 + 2 * i], dir: "left" }));
  sides.right.forEach((p, i) => pins.push({ ...p, at: [W, y0 + 2 * i], dir: "right" }));
  const topStart = Math.round((W - topSpan) / 2);
  const botStart = Math.round((W - (sides.bottom.length - 1) * pitch) / 2);
  sides.top.forEach((p, i) => pins.push({ ...p, at: [topStart + topAt[i]!, 0], dir: "up" }));
  sides.bottom.forEach((p, i) => pins.push({ ...p, at: [botStart + pitch * i, H], dir: "down" }));
  const leads = pins.map((p) => {
    const [x, y] = p.at;
    return p.dir === "left" ? `M${x} ${y} H${x + 1}` : p.dir === "right" ? `M${x} ${y} H${x - 1}` : p.dir === "up" ? `M${x} ${y} V${y + 1}` : `M${x} ${y} V${y - 1}`;
  });
  return {
    id: "ic", version: 1, refPrefix: "U", source: "original", kind: "ic",
    pins,
    align: [0, y0],
    graphics: [{ d: leads.join(" ") }, { d: `M1 1 H${W - 1} V${H - 1} H1 Z` }],
    art: { x: 0, y: 0, w: W, h: H },
    labelPrefer: ["above", "below"],
  };
}

export const ORIENTS: Orient[] = ([0, 90, 180, 270] as Rot[]).flatMap((rot) => [{ rot, flip: false }, { rot, flip: true }]);

/** Routing keep-out in local units: artwork box rounded outward (SPEC 7.1). */
export function keepOut(s: SymbolDef): Box { return gridBox(s.art); }

/**
 * Loader check (SPEC 7.1, rev C.1): in every orientation, each pin anchor is on the
 * keep-out boundary and its approach point is strictly outside. Throws on failure.
 */
export function checkSymbol(s: SymbolDef): void {
  for (const o of ORIENTS) {
    const ko = xformBox(keepOut(s), [0, 0], o);
    for (const p of s.pins) {
      if (!p.at.every(Number.isInteger)) throw new Error(`${s.id}: pin ${p.number} is off-grid`);
      const a = xformPt(p.at, [0, 0], o);
      const d = xformDir(p.dir, o);
      const onBoundary = inClosedBox(a, ko) && (a[0] === ko.x || a[0] === ko.x + ko.w || a[1] === ko.y || a[1] === ko.y + ko.h);
      if (!onBoundary) throw new Error(`${s.id}: pin ${p.number} is not on the keep-out boundary (rot ${o.rot}${o.flip ? " flip" : ""})`);
      if (inClosedBox(step(a, d), ko)) throw new Error(`${s.id}: pin ${p.number} approach point is inside the keep-out (rot ${o.rot}${o.flip ? " flip" : ""})`);
    }
  }
}
