// Layout helpers for the Phase 0b symbol kinds (SPEC 7.2, 9.2 step 3b): header parts with
// their own pins, and default orientations for transistors, potentiometers, relays and headers.
// Kept out of layout.ts so the pipeline there stays one readable pass.

import type { Orient } from "../geom/geom.js";
import type { Net, PinDef } from "../core/model.js";
import { headerSymbol, type SymbolDef } from "../symbols/library.js";
import { measure } from "../text/font.js";
import { railDirection } from "./ports.js";

/** Header pins as declared on the part; a pin without a role is passive unless its name says supply or ground. */
export function headerPins(pins: PinDef[]): PinDef[] {
  return pins.map((p) => {
    if (p.role) return p;
    const role = /^(GND|VSS|AGND|DGND)$/i.test(p.name) ? "ground" : /^(VCC|VDD|VIN|3V3|5V|V\+|VBAT)$/i.test(p.name) ? "power_in" : "passive";
    return { ...p, role };
  });
}

export function headerFor(pins: PinDef[]): SymbolDef {
  return headerSymbol(pins, (text, size) => measure(text, size).width / 10);
}

export interface OrientContext {
  /** Drawn terminal ("Q1[B]") -> net id. */
  drawnNet: Map<string, string>;
  netById: Map<string, Net>;
  /** Nets drawn with supply or ground symbols. */
  portNet: Set<string>;
  /** Column of the part being oriented. */
  col: number;
  /** Average column of the other parts on a net. */
  netCol: (net: string, self: string) => number | undefined;
}

const ROT0: Orient = { rot: 0, flip: false };
const MIRROR_X: Orient = { rot: 0, flip: true };     // left-right mirror
const MIRROR_Y: Orient = { rot: 180, flip: true };   // top-bottom mirror
const ROT180: Orient = { rot: 180, flip: false };    // both

/** Control pin, collector or drain, emitter or source, and N or P type. */
export const TRANSISTOR: Record<string, { ctrl: string; main: string; ref: string; n: boolean }> = {
  npn: { ctrl: "B", main: "C", ref: "E", n: true },
  pnp: { ctrl: "B", main: "C", ref: "E", n: false },
  nmos: { ctrl: "G", main: "D", ref: "S", n: true },
  pmos: { ctrl: "G", main: "D", ref: "S", n: false },
};

/** N types have their emitter or source at the bottom at rotation 0, P types at the top. */
export function transistorFlipY(n: boolean, main: Net | undefined, ref: Net | undefined): boolean {
  const mainRail = main && railDirection(main), refRail = ref && railDirection(ref);
  return n ? refRail === "up" || mainRail === "down" : refRail === "down" || mainRail === "up";
}

/**
 * Default orientation (SPEC 9.2 step 3b) for the kinds layout.ts does not orient itself.
 * Returns undefined for the kinds it leaves alone. Every rule is a fixed test on net kinds
 * and columns, so the result is deterministic.
 */
export function defaultOrient(sym: SymbolDef, id: string, ctx: OrientContext): Orient | undefined {
  const net = (pin: string) => ctx.drawnNet.get(`${id}[${pin}]`);
  const netOfPin = (pin: string) => { const n = net(pin); return n ? ctx.netById.get(n) : undefined; };
  const rail = (pin: string) => { const n = netOfPin(pin); return n && railDirection(n); };
  const hasPort = (pin: string) => { const n = net(pin); return n !== undefined && ctx.portNet.has(n); };
  /** The nets of these pins sit, on average, left of the part (port nets do not count). */
  const fromLeft = (pins: string[]) => {
    const cs = pins.flatMap((p) => { const n = net(p); const c = n && !ctx.portNet.has(n) ? ctx.netCol(n, id) : undefined; return c === undefined ? [] : [c]; });
    return cs.length ? cs.reduce((s, c) => s + c, 0) / cs.length < ctx.col : undefined;
  };
  const toRight = (pins: string[]) => {
    const cs = pins.flatMap((p) => { const n = net(p); const c = n && !ctx.portNet.has(n) ? ctx.netCol(n, id) : undefined; return c === undefined ? [] : [c]; });
    return cs.length > 0 && cs.reduce((s, c) => s + c, 0) / cs.length > ctx.col;
  };

  if (sym.kind === "transistor") {
    const t = TRANSISTOR[sym.id];
    if (!t) return ROT0;
    const flipY = transistorFlipY(t.n, netOfPin(t.main), netOfPin(t.ref));
    // The base or gate faces its driver: mirror left-right when the driver sits to the right.
    const flipX = toRight([t.ctrl]);
    return flipX && flipY ? ROT180 : flipY ? MIRROR_Y : flipX ? MIRROR_X : ROT0;
  }

  if (sym.kind === "potentiometer") {
    // Like a two-pin part on its track ends 1 and 3; the wiper (local top) ends up on the right
    // when vertical and on top when horizontal.
    const down3: Orient = { rot: 90, flip: false }, down1: Orient = { rot: 90, flip: true };
    if (rail("3") === "down") return down3;
    if (rail("1") === "down") return down1;
    if (hasPort("1") && rail("1") === "up") return down3;
    if (hasPort("3") && rail("3") === "up") return down1;
    const n1 = net("1"), n3 = net("3");
    const c1 = n1 ? ctx.netCol(n1, id) : undefined, c3 = n3 ? ctx.netCol(n3, id) : undefined;
    return c1 !== undefined && c3 !== undefined && c3 < c1 ? MIRROR_X : ROT0;
  }

  if (sym.kind === "relay") return ROT0; // coil A1 at the top, contacts to the right of the coil

  if (sym.kind === "header") {
    // Pins leave to the right; mirror when the circuit they feed lies to the left.
    return fromLeft(sym.pins.map((p) => p.number)) ? MIRROR_X : ROT0;
  }
  return undefined;
}
