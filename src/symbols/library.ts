// Built-in symbols (SPEC 7). Drawn for this project ("source": "original").
// Units are grid units (1 G = 10 SVG units). Pin anchors sit at the outer end of each lead.

import { gridBox, inClosedBox, step, xformBox, xformDir, xformPt, type Box, type Dir, type Orient, type Pt, type Rot } from "../geom/geom.js";
import type { PinDef, Role } from "../core/model.js";

export interface SymPin extends PinDef { at: Pt; dir: Dir }
export interface Graphic { d: string; fill?: "none" | "stroke" }

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
  kind: "two-pin" | "source" | "opamp" | "ic" | "port";
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

export const BUILTIN: Record<string, SymbolDef> = Object.fromEntries(
  [RESISTOR, CAPACITOR, LED, BATTERY, VSOURCE, OPAMP, GROUND, SUPPLY].map((s) => [s.id, s]),
);

/**
 * Generated box for chips and modules (SPEC 7.3). Side pins are 2 G apart; top and bottom
 * pins are `pitch` G apart, wide enough that their horizontal names do not run together.
 */
export function icSymbol(sides: { left: PinDef[]; right: PinDef[]; top: PinDef[]; bottom: PinDef[] }, innerWidth: number, pitch = 2): SymbolDef {
  const rows = Math.max(sides.left.length, sides.right.length, 1);
  const cols = Math.max(sides.top.length, sides.bottom.length, 0);
  const W = Math.max(innerWidth, (cols - 1) * pitch + 4, 6) + 2; // +2 for the 1 G leads on each side
  const y0 = sides.top.length ? 4 : 2;                 // room for top pin names inside the box
  const H = y0 + (rows - 1) * 2 + (sides.bottom.length ? 4 : 2);
  const pins: SymPin[] = [];
  sides.left.forEach((p, i) => pins.push({ ...p, at: [0, y0 + 2 * i], dir: "left" }));
  sides.right.forEach((p, i) => pins.push({ ...p, at: [W, y0 + 2 * i], dir: "right" }));
  const topStart = Math.round((W - (sides.top.length - 1) * pitch) / 2);
  const botStart = Math.round((W - (sides.bottom.length - 1) * pitch) / 2);
  sides.top.forEach((p, i) => pins.push({ ...p, at: [topStart + pitch * i, 0], dir: "up" }));
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
